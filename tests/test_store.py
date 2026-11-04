from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from decimal import Decimal
import tempfile
import unittest

from pantry_relay.core import Conflict, GateError, InputError
from pantry_relay.store import Store
from test_core import NOW, ROOT, candidate, fixture, review
from pantry_relay.core import load_json


class LedgerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(self.temp.name + '/pantry.sqlite3', clock=lambda: datetime.fromisoformat(NOW))
        self.store.initialize(fixture())

    def test_consume_and_retry_preserve_one_receipt_and_exact_balances(self):
        receipt = self.store.consume('tomato_eggs', 1, 'dinner-20261104', expected_revision=0)
        retry = self.store.consume('tomato_eggs', 1, 'dinner-20261104', at='2027-01-01T00:00:00Z', expected_revision=0)
        self.assertTrue(retry['replayed'])
        self.assertEqual(receipt['receipt_id'], retry['receipt_id'])
        self.assertEqual(receipt['changes'][0]['remaining'], '0')
        self.assertFalse(receipt['safety_guarantee'])
        self.assertEqual(self.store.inventory()['revision'], 1)
        self.assertEqual(len(self.store.audit()), 2)
        self.assertEqual(self.store.receipt('dinner-20261104'), receipt)
        with self.assertRaises(Conflict): self.store.consume('plain_oats', 1, 'dinner-20261104', expected_revision=0)

    def test_partial_allocation_on_hold_or_shortage_rolls_back_everything(self):
        before = self.store.inventory()
        for recipe in ('milk_oats', 'tomato_pasta', 'peanut_oats'):
            with self.subTest(recipe=recipe), self.assertRaises(GateError):
                self.store.consume(recipe, 1, 'blocked-' + recipe, expected_revision=0)
        self.assertEqual(self.store.inventory(), before)
        self.assertEqual(len(self.store.audit()), 1)

    def test_stale_preview_is_rejected_and_preview_never_reserves(self):
        snapshot = self.store.plan()
        self.assertEqual(self.store.plan(), snapshot)
        self.store.consume('plain_oats', 1, 'oats-first-use', expected_revision=0)
        with self.assertRaises(Conflict): self.store.consume('tomato_eggs', 1, 'dinner-stale-one', expected_revision=0)
        self.assertEqual(self.store.inventory()['revision'], 1)
        self.assertTrue(candidate(self.store.plan(), 'tomato_eggs')['can_consume'])

    def test_concurrent_attempts_cannot_spend_the_same_snapshot(self):
        def spend(index):
            try: return self.store.consume('tomato_eggs', 1, f'concurrent-{index:03d}', expected_revision=0)
            except Conflict: return None
        with ThreadPoolExecutor(max_workers=5) as pool: results = list(pool.map(spend, range(5)))
        self.assertEqual(sum(result is not None for result in results), 1)
        state = self.store.inventory()
        self.assertEqual(state['revision'], 1)
        self.assertTrue(all(Decimal(lot['quantity']) >= 0 for lot in state['project']['lots']))

    def test_review_resolves_only_entered_metadata_and_invalidates_preview(self):
        request = load_json(ROOT / 'examples/review-milk.json')
        self.assertEqual(review(self.store.plan(), 'milk_open')['status'], 'hold')
        self.store.review_lot('milk_open', request)
        self.assertEqual(review(self.store.plan(), 'milk_open')['status'], 'eligible_user_confirmed')
        self.assertEqual(self.store.inventory()['project']['lots'][4]['quantity'], '500')
        with self.assertRaises(Conflict): self.store.review_lot('milk_open', request)
        with self.assertRaises(Conflict): self.store.consume('milk_oats', 1, 'milk-after-review', expected_revision=0)
        self.store.consume('milk_oats', 1, 'milk-after-review', expected_revision=1)
        self.assertEqual(self.store.inventory()['project']['lots'][4]['quantity'], '300')

    def test_review_cannot_change_quantity_or_replace_existing_sources(self):
        before = self.store.inventory()
        invalid = [
            {'expected_revision': 0, 'changes': {'quantity': '999'}, 'sources': []},
            {'expected_revision': 0, 'changes': {'confirmed_usable': False}, 'sources': [fixture()['sources'][0]]},
            {'expected_revision': 0, 'changes': {'labels': [{'kind': 'use_by', 'date': '2026-11-10', 'source_id': 'made_up'}]}, 'sources': []},
        ]
        for update in invalid:
            with self.subTest(update=update), self.assertRaises(InputError): self.store.review_lot('milk_open', update)
            self.assertEqual(self.store.inventory(), before)
        with self.assertRaises(Conflict): self.store.initialize(fixture())

    def test_metadata_gate_is_rechecked_at_consumption_time(self):
        self.assertTrue(candidate(self.store.plan(), 'tomato_eggs')['can_consume'])
        data = self.store.inventory()['project']
        # A larger amount requires the opened lot, so later expiry cannot silently
        # reuse the earlier eligible allocation or deduct only a partial recipe.
        data['recipes'][0]['ingredients'][0]['quantity'] = '400'
        fresh = Store(self.temp.name + '/other.sqlite3', clock=lambda: datetime.fromisoformat(NOW))
        fresh.initialize(data)
        self.assertTrue(candidate(fresh.plan(), 'tomato_eggs')['can_consume'])
        before = fresh.inventory()
        with self.assertRaises(GateError): fresh.consume('tomato_eggs', 1, 'later-gated-use', at='2026-11-04T18:00:00+08:00', expected_revision=0)
        self.assertEqual(fresh.inventory(), before)


if __name__ == '__main__': unittest.main()
