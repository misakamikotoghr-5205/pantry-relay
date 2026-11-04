from copy import deepcopy
import json
from pathlib import Path
import unittest

from pantry_relay.core import InputError, load_json, parse_json, plan_project, validate_project

ROOT = Path(__file__).resolve().parents[1]
NOW = '2026-11-04T12:00:00+08:00'


def fixture():
    return load_json(ROOT / 'examples/pantry.json')


def candidate(plan, recipe_id):
    return next(item for item in plan['candidates'] if item['recipe_id'] == recipe_id)


def review(plan, lot_id):
    return next(item for item in plan['lot_review'] if item['lot_id'] == lot_id)


class PlanningTests(unittest.TestCase):
    def test_fefo_spans_two_lots_with_exact_quantities_and_source_trail(self):
        data = fixture(); before = deepcopy(data)
        plan = plan_project(data, NOW)
        meal = candidate(plan, 'tomato_eggs')
        self.assertEqual(plan['next_recipe_id'], 'tomato_eggs')
        self.assertEqual([(a['lot_id'], a['quantity']) for a in meal['allocations']], [('tomato_open', '150'), ('tomato_sealed', '50'), ('eggs', '2')])
        self.assertEqual(meal['allocations'][0]['constraints'][1]['source_ids'], ['opened_tomato', 'label_tomato_a'])
        self.assertTrue(all(a['confirmation_source_id'] for a in meal['allocations']))
        self.assertEqual(data, before)
        self.assertFalse(plan['reservations_created'])
        self.assertFalse(review(plan, 'tomato_open')['safety_guarantee'])

    def test_opening_interval_is_entered_not_guessed_and_expiry_is_exclusive(self):
        plan = plan_project(fixture(), NOW)
        self.assertIn('missing_opening_instruction', {r['code'] for r in review(plan, 'milk_open')['reasons']})
        before = plan_project(fixture(), '2026-11-04T17:59:59.999999+08:00')
        at = plan_project(fixture(), '2026-11-04T18:00:00+08:00')
        self.assertEqual(review(before, 'tomato_open')['status'], 'eligible_user_confirmed')
        self.assertEqual(review(at, 'tomato_open')['status'], 'hold')
        self.assertIn('opening_instruction_elapsed', {r['code'] for r in review(at, 'tomato_open')['reasons']})

    def test_packaging_only_conflicts_and_future_records_stay_on_hold(self):
        data = fixture()
        data['lots'][1]['packed_on'] = {'date': '2026-11-09', 'source_id': 'label_tomato_b'}
        data['lots'][0]['opened_at'] = '2026-11-05T12:00:00+08:00'
        plan = plan_project(data, NOW)
        self.assertIn('missing_label_date', {r['code'] for r in review(plan, 'packed_only')['reasons']})
        self.assertIn('conflicting_label_dates', {r['code'] for r in review(plan, 'conflict_sauce')['reasons']})
        self.assertIn('future_opening_record', {r['code'] for r in review(plan, 'tomato_open')['reasons']})
        codes = {r['code'] for r in review(plan, 'tomato_sealed')['reasons']}
        self.assertTrue({'future_packaging_date', 'date_order_conflict'} <= codes)

    def test_date_only_cutoff_uses_project_timezone_and_never_proves_safety(self):
        data = fixture()
        data['lots'][1]['labels'][0]['date'] = '2026-11-04'
        prior = plan_project(data, '2026-11-04T15:59:59.999999Z')
        after = plan_project(data, '2026-11-04T16:00:00Z')
        self.assertEqual(review(prior, 'tomato_sealed')['status'], 'eligible_user_confirmed')
        self.assertEqual(review(after, 'tomato_sealed')['status'], 'hold')
        self.assertIn('do not establish', after['safety_note'])

    def test_user_filters_cannot_be_overridden_by_stock_or_recipe(self):
        data = fixture(); data['preferences']['avoid_ingredients'] = ['egg']
        plan = plan_project(data, NOW)
        self.assertFalse(candidate(plan, 'tomato_eggs')['can_consume'])
        peanuts = candidate(plan, 'peanut_oats')
        self.assertTrue(peanuts['excluded'])
        self.assertEqual(peanuts['allocations'], [])
        self.assertEqual(peanuts['shopping_list'], [])
        self.assertEqual(review(plan, 'peanuts')['status'], 'hold')

    def test_held_stock_and_absent_stock_have_different_replenishment_outputs(self):
        plan = plan_project(fixture(), NOW)
        milk = candidate(plan, 'milk_oats')
        self.assertFalse(milk['can_consume'])
        self.assertEqual(milk['eligible_stock_shortages'][0]['held_lot_ids'], ['milk_open'])
        self.assertEqual(milk['shopping_list'], [])
        self.assertEqual(candidate(plan, 'tomato_pasta')['shopping_list'], [{'ingredient': 'pasta', 'quantity': '100', 'unit': 'g'}])

    def test_decimal_quantities_do_not_drift(self):
        data = fixture(); data['lots'][3]['quantity'] = '0.3'
        data['recipes'][1]['ingredients'][0]['quantity'] = '0.1'
        planned = candidate(plan_project(data, NOW, 3), 'plain_oats')
        self.assertTrue(planned['can_consume'])
        self.assertEqual(planned['allocations'][0]['quantity'], '0.3')

    def test_invalid_units_missing_confirmation_and_forged_source_kind_rejected(self):
        mutations = [
            lambda p: p['lots'][0].update(unit='ml'),
            lambda p: p['lots'][2].update(quantity='1.5'),
            lambda p: p['lots'][0].pop('confirmation_source_id'),
            lambda p: p['lots'][0]['labels'][0].update(source_id='recipe_plain_oats'),
            lambda p: p.update(timezone='../UTC'),
            lambda p: p['lots'][0].update(quantity=150),
            lambda p: p['recipes'][0]['ingredients'][0].update(unit=[]),
        ]
        for mutate in mutations:
            with self.subTest(mutation=mutate):
                data = fixture(); mutate(data)
                with self.assertRaises(InputError): validate_project(data)

    def test_json_duplicate_nonfinite_and_oversized_input_are_rejected(self):
        for raw in (b'{"a":1,"a":2}', b'{"n":NaN}', b'x' * 1_000_001, b'\xff'):
            with self.subTest(raw=raw[:30]), self.assertRaises(InputError): parse_json(raw)


if __name__ == '__main__': unittest.main()
