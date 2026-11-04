"""Private SQLite ledger: preview, revision-aware review and idempotent consumption."""

from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import secrets
import sqlite3

from .core import Conflict, GateError, InputError, canonical, decimal_text, identifier, plan_project, quantity, stamp, timestamp, validate_project


class Store:
    def __init__(self, path, clock=None):
        if str(path) == ':memory:': raise InputError('Use a persistent SQLite file for receipts')
        self.path = str(path)
        self.clock = clock or (lambda: datetime.now(timezone.utc))
        target = Path(path); target.parent.mkdir(parents=True, exist_ok=True)
        descriptor = os.open(target, os.O_CREAT | os.O_RDWR, 0o600); os.close(descriptor)
        os.chmod(target, 0o600)
        with self.transaction() as database:
            database.executescript('''
                CREATE TABLE IF NOT EXISTS pantry (id INTEGER PRIMARY KEY CHECK(id=1), revision INTEGER NOT NULL, project_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS receipts (key TEXT PRIMARY KEY, intent_hash TEXT NOT NULL, receipt_json TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS audit (seq INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, event TEXT NOT NULL, details_json TEXT NOT NULL);
            ''')

    @contextmanager
    def transaction(self):
        database = sqlite3.connect(self.path, timeout=10, isolation_level=None)
        database.row_factory = sqlite3.Row
        try:
            database.execute('BEGIN IMMEDIATE')
            yield database
            if database.in_transaction: database.execute('COMMIT')
        except Exception:
            if database.in_transaction: database.execute('ROLLBACK')
            raise
        finally:
            database.close()

    def _event(self, database, event, details):
        database.execute('INSERT INTO audit(at,event,details_json) VALUES (?,?,?)', (stamp(self.clock()), event, canonical(details)))

    @staticmethod
    def _read(database):
        row = database.execute('SELECT revision,project_json FROM pantry WHERE id=1').fetchone()
        if not row: raise InputError('Pantry is not initialized; run init with a user-provided project first')
        return json.loads(row['project_json']), row['revision']

    def initialize(self, data):
        project = validate_project(data)
        with self.transaction() as database:
            if database.execute('SELECT id FROM pantry').fetchone(): raise Conflict('Pantry already initialized; existing balances and receipts cannot be overwritten')
            database.execute('INSERT INTO pantry VALUES (1,0,?)', (canonical(project),))
            self._event(database, 'INITIALIZED', {'lot_count': len(project['lots']), 'recipe_count': len(project['recipes'])})
        return {'revision': 0, 'lots': len(project['lots']), 'recipes': len(project['recipes'])}

    def inventory(self):
        with self.transaction() as database:
            project, revision = self._read(database)
        return {'revision': revision, 'project': project}

    def plan(self, at=None, servings=1):
        snapshot = self.inventory()
        result = plan_project(snapshot['project'], at or stamp(self.clock()), servings)
        result['revision'] = snapshot['revision']
        return result

    def consume(self, recipe_id, servings, key, *, at=None, expected_revision=None):
        identifier(recipe_id, 'recipe id')
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z0-9_-]{12,128}', key): raise InputError('Idempotency key must contain 12–128 letters, digits, hyphens or underscores')
        if type(servings) is not int or not 1 <= servings <= 20: raise InputError('servings must be an integer in 1..20')
        if expected_revision is not None and (type(expected_revision) is not int or expected_revision < 0): raise InputError('expected_revision must be a nonnegative integer')
        intent_hash = hashlib.sha256(canonical({'recipe_id': recipe_id, 'servings': servings, 'expected_revision': expected_revision}).encode()).hexdigest()
        with self.transaction() as database:
            prior = database.execute('SELECT * FROM receipts WHERE key=?', (key,)).fetchone()
            if prior:
                if prior['intent_hash'] != intent_hash: raise Conflict('Idempotency key belongs to a different consumption intent')
                return json.loads(prior['receipt_json']) | {'replayed': True}
            project, revision = self._read(database)
            if expected_revision is not None and expected_revision != revision: raise Conflict('Inventory changed; request a new plan before consuming')
            planned = plan_project(project, at or stamp(self.clock()), servings)
            candidate = next((item for item in planned['candidates'] if item['recipe_id'] == recipe_id), None)
            if candidate is None: raise InputError('Unknown recipe id')
            if not candidate['can_consume']: raise GateError(candidate)
            changes = []
            for allocation in candidate['allocations']:
                lot = next(lot for lot in project['lots'] if lot['id'] == allocation['lot_id'])
                before = quantity(lot['quantity']); after = before - quantity(allocation['quantity'])
                if after < 0: raise Conflict('Stock changed; consumption was rolled back')
                lot['quantity'] = decimal_text(after)
                changes.append({'lot_id': lot['id'], 'ingredient': lot['ingredient'], 'before': decimal_text(before), 'used': allocation['quantity'], 'remaining': lot['quantity'], 'unit': lot['unit'],
                                'constraints': allocation['constraints'], 'confirmation_source_id': allocation['confirmation_source_id']})
            receipt = {'receipt_id': 'use_' + secrets.token_hex(12), 'recipe_id': recipe_id, 'recipe_source_id': candidate['source_id'], 'servings': servings,
                       'as_of': planned['as_of'], 'revision_before': revision, 'revision_after': revision + 1, 'changes': changes,
                       'replayed': False, 'safety_guarantee': False, 'sources': planned['sources']}
            database.execute('UPDATE pantry SET revision=?,project_json=? WHERE id=1', (revision + 1, canonical(project)))
            database.execute('INSERT INTO receipts VALUES (?,?,?)', (key, intent_hash, canonical(receipt)))
            self._event(database, 'CONSUMED', {'receipt_id': receipt['receipt_id'], 'recipe_id': recipe_id, 'revision': revision + 1})
            return receipt

    def receipt(self, key):
        with self.transaction() as database:
            row = database.execute('SELECT receipt_json FROM receipts WHERE key=?', (key,)).fetchone()
            if not row: raise InputError('Receipt not found')
            return json.loads(row['receipt_json'])

    def review_lot(self, lot_id, update):
        from .core import fields
        fields(update, {'expected_revision', 'changes', 'sources'}, name='lot review')
        if type(update['expected_revision']) is not int or update['expected_revision'] < 0: raise InputError('expected_revision must be a nonnegative integer')
        allowed = {'labels', 'packed_on', 'opened_at', 'opened_source_id', 'after_open_hours', 'after_open_source_id', 'confirmed_usable', 'confirmation_source_id', 'allergens'}
        if not isinstance(update['changes'], dict) or not update['changes'] or set(update['changes']) - allowed: raise InputError('Review can update sourced label/confirmation metadata, not quantities or ingredient identity')
        if not isinstance(update['sources'], list): raise InputError('Review sources must be a list')
        with self.transaction() as database:
            project, revision = self._read(database)
            if revision != update['expected_revision']: raise Conflict('Inventory changed; reload before reviewing a lot')
            lot = next((lot for lot in project['lots'] if lot['id'] == lot_id), None)
            if lot is None: raise InputError('Unknown lot id')
            project['sources'].extend(deepcopy(update['sources']))
            for field, value in update['changes'].items():
                if value is None: lot.pop(field, None)
                else: lot[field] = deepcopy(value)
            project = validate_project(project)
            database.execute('UPDATE pantry SET revision=?,project_json=? WHERE id=1', (revision + 1, canonical(project)))
            self._event(database, 'LOT_REVIEWED', {'lot_id': lot_id, 'fields': sorted(update['changes']), 'source_ids_added': [item['id'] for item in update['sources']], 'revision': revision + 1})
            return {'lot_id': lot_id, 'revision': revision + 1, 'quantity_changed': False}

    def audit(self):
        with self.transaction() as database:
            return [{'seq': row['seq'], 'at': row['at'], 'event': row['event'], 'details': json.loads(row['details_json'])} for row in database.execute('SELECT * FROM audit ORDER BY seq')]
