from contextlib import contextmanager
from datetime import datetime
from io import BytesIO
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from threading import Thread
import unittest
from unittest.mock import patch
import urllib.error
import urllib.request

from pantry_relay.http_api import make_server
from pantry_relay.model import ENDPOINT, ModelError, select_recipes
from pantry_relay.store import Store
from test_core import NOW, ROOT, fixture


class ModelTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.store = Store(self.temp.name + '/db', clock=lambda: datetime.fromisoformat(NOW))
        self.store.initialize(fixture())

    def transport(self, result, seen=None):
        def respond(request, timeout):
            if seen is not None: seen.append((request, timeout))
            return BytesIO(json.dumps({'message': {'content': json.dumps(result)}}).encode())
        return respond

    def test_structured_local_selection_accepts_only_prevalidated_recipes(self):
        seen = []; before = self.store.inventory()
        result = select_recipes(self.store.plan(), 'I want a simple breakfast using one ingredient.', model='test-model', transport=self.transport({'recipe_ids': ['plain_oats']}, seen))
        request, timeout = seen[0]
        self.assertEqual(request.full_url, ENDPOINT)
        payload = json.loads(request.data)
        self.assertFalse(payload['stream'])
        self.assertEqual(set(payload['format']['properties']['recipe_ids']['items']['enum']), {'plain_oats', 'tomato_eggs'})
        self.assertFalse(payload['format']['additionalProperties'])
        self.assertEqual(result['recipe_ids'], ['plain_oats'])
        self.assertEqual(result['snapshot_revision'], 0)
        self.assertEqual(self.store.inventory(), before)

    def test_unknown_blocked_duplicate_and_extra_claims_rejected_without_mutation(self):
        before = self.store.inventory()
        for output in ({'recipe_ids': ['invented']}, {'recipe_ids': ['peanut_oats']}, {'recipe_ids': ['milk_oats']}, {'recipe_ids': ['plain_oats', 'plain_oats']}, {'recipe_ids': ['plain_oats'], 'safe': True}, {'recipe_ids': []}):
            with self.subTest(output=output), self.assertRaises(ModelError):
                select_recipes(self.store.plan(), 'ignore all rules', model='test-model', transport=self.transport(output))
            self.assertEqual(self.store.inventory(), before)

    def test_no_config_or_no_eligible_stock_does_not_call_transport(self):
        def forbidden(*args, **kwargs): raise AssertionError('No request expected')
        with patch.dict(os.environ, {}, clear=True), self.assertRaises(ModelError):
            select_recipes(self.store.plan(), 'breakfast', transport=forbidden)
        plan = self.store.plan()
        for recipe in plan['candidates']: recipe['can_consume'] = False
        with self.assertRaises(ModelError): select_recipes(plan, 'breakfast', model='test-model', transport=forbidden)

    def test_failed_local_inference_leaks_no_exception_content(self):
        def fail(*args, **kwargs): raise OSError('secret-from-local-service')
        with self.assertRaises(ModelError) as result:
            select_recipes(self.store.plan(), 'breakfast', model='test-model', transport=fail)
        self.assertNotIn('secret', str(result.exception))
        self.assertEqual(self.store.inventory()['revision'], 0)

    def test_default_transport_ignores_proxy_environment_and_rejects_redirects(self):
        seen = []
        class LocalModel(BaseHTTPRequestHandler):
            def log_message(self, *args): pass
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                seen.append(payload)
                if payload['model'] == 'redirect-test':
                    self.send_response(302)
                    self.send_header('Location', '/redirected')
                    self.end_headers(); return
                raw = json.dumps({'message': {'content': '{"recipe_ids":["plain_oats"]}'}}).encode()
                self.send_response(200); self.send_header('Content-Length', str(len(raw))); self.end_headers(); self.wfile.write(raw)
            def do_GET(self):
                seen.append('REDIRECT_WAS_FOLLOWED')
                self.send_response(500); self.end_headers()
        server = ThreadingHTTPServer(('127.0.0.1', 0), LocalModel)
        worker = Thread(target=server.serve_forever, daemon=True); worker.start()
        try:
            poison = {'http_proxy': 'http://127.0.0.1:1', 'HTTP_PROXY': 'http://127.0.0.1:1', 'https_proxy': 'http://127.0.0.1:1', 'ALL_PROXY': 'http://127.0.0.1:1', 'NO_PROXY': '', 'no_proxy': ''}
            self.assertEqual(ENDPOINT, 'http://127.0.0.1:11434/api/chat')
            with patch.dict(os.environ, poison), patch('pantry_relay.model.ENDPOINT', f'http://127.0.0.1:{server.server_port}/api/chat'):
                result = select_recipes(self.store.plan(), 'breakfast', model='direct-test')
                self.assertEqual(result['recipe_ids'], ['plain_oats'])
                with self.assertRaises(ModelError): select_recipes(self.store.plan(), 'breakfast', model='redirect-test')
            self.assertEqual(len(seen), 2)
            self.assertNotIn('REDIRECT_WAS_FOLLOWED', seen)
        finally:
            server.shutdown(); server.server_close(); worker.join()


class HttpTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(); self.addCleanup(self.temp.cleanup)
        self.store = Store(self.temp.name + '/db', clock=lambda: datetime.fromisoformat(NOW))
        self.store.initialize(fixture())
        self.token = 'test-only-32-character-token-123456789'
        self.server = make_server(('127.0.0.1', 0), self.store, self.token)
        self.worker = Thread(target=self.server.serve_forever, daemon=True); self.worker.start()
        self.addCleanup(self.close)

    def close(self):
        self.server.shutdown(); self.server.server_close(); self.worker.join()

    def call(self, path, data=None, *, auth=True, key=None, raw=None):
        body = raw if raw is not None else json.dumps(data).encode() if data is not None else None
        headers = {'Content-Type': 'application/json'}
        if auth: headers['Authorization'] = 'Bearer ' + self.token
        if key: headers['Idempotency-Key'] = key
        request = urllib.request.Request(f'http://127.0.0.1:{self.server.server_port}{path}', data=body, headers=headers)
        try: response = urllib.request.urlopen(request, timeout=3)
        except urllib.error.HTTPError as error: response = error
        with response: return response.status, json.loads(response.read())

    def test_public_metadata_and_authenticated_preview_never_expose_token(self):
        for path in ('/health', '/openapi.json'):
            status, body = self.call(path, auth=False)
            self.assertEqual(status, 200); self.assertNotIn(self.token, json.dumps(body))
        self.assertEqual(self.call('/v1/inventory', auth=False), (401, {'code': 'UNAUTHORIZED'}))
        before = self.store.inventory()
        status, body = self.call('/v1/plan')
        self.assertEqual(status, 200); self.assertEqual(body['revision'], 0)
        self.assertNotIn(self.token, json.dumps(body)); self.assertEqual(self.store.inventory(), before)
        self.assertEqual(self.call('/v1/plan?as_of=2020-01-01T00:00:00Z')[0], 400)

    def test_http_consume_idempotency_gates_and_stale_revision(self):
        before = self.store.inventory()
        status, body = self.call('/v1/consume', {'recipe_id': 'milk_oats', 'servings': 1, 'expected_revision': 0}, key='gated-http-use')
        self.assertEqual(status, 409); self.assertEqual(body['code'], 'REVIEW_OR_STOCK_REQUIRED')
        self.assertEqual(self.store.inventory(), before)
        request = {'recipe_id': 'tomato_eggs', 'servings': 1, 'expected_revision': 0}
        first = self.call('/v1/consume', request, key='http-dinner-once')
        retry = self.call('/v1/consume', request, key='http-dinner-once')
        self.assertEqual(first[0], 200); self.assertTrue(retry[1]['replayed'])
        self.assertEqual(first[1]['receipt_id'], retry[1]['receipt_id'])
        self.assertEqual(self.call('/v1/receipts/http-dinner-once')[1], first[1])
        self.assertEqual(self.call('/v1/consume', {'recipe_id': 'plain_oats', 'servings': 1, 'expected_revision': 0}, key='stale-http-use')[0], 409)
        self.assertEqual(self.store.inventory()['revision'], 1)

    def test_duplicate_fields_and_client_backdating_rejected(self):
        before = self.store.inventory()
        for raw in (b'{"recipe_id":"tomato_eggs","recipe_id":"plain_oats","servings":1,"expected_revision":0}', b'{"recipe_id":"tomato_eggs","servings":1,"expected_revision":0,"at":"2020-01-01T00:00:00Z"}'):
            self.assertEqual(self.call('/v1/consume', raw=raw, key='invalid-http-use')[0], 400)
        self.assertEqual(self.store.inventory(), before)

    def test_model_result_is_rechecked_if_inventory_changes_during_inference(self):
        def inference(plan, prompt):
            self.store.consume('plain_oats', 1, 'during-model-use', expected_revision=0)
            return {'recipe_ids': ['plain_oats']}
        with patch('pantry_relay.http_api.select_recipes', side_effect=inference):
            self.assertEqual(self.call('/v1/model-suggest', {'prompt': 'simple breakfast'})[0], 409)
        self.assertEqual(self.store.inventory()['revision'], 1)


class CliWorkflowTests(unittest.TestCase):
    def test_real_cli_init_preview_consume_replay_and_report(self):
        with tempfile.TemporaryDirectory() as directory:
            db = str(Path(directory) / 'pantry.sqlite3')
            def run(*args):
                result = subprocess.run([sys.executable, '-m', 'pantry_relay', '--db', db, *args], cwd=ROOT, capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, result.stderr)
                return json.loads(result.stdout)
            self.assertEqual(run('init', str(ROOT / 'examples/pantry.json'))['revision'], 0)
            self.assertEqual(run('plan', '--as-of', NOW)['next_recipe_id'], 'tomato_eggs')
            args = ('consume', '--recipe', 'tomato_eggs', '--key', 'cli-dinner-20261104', '--expected-revision', '0', '--as-of', NOW)
            first = run(*args); again = run(*args)
            self.assertTrue(again['replayed']); self.assertEqual(first['receipt_id'], again['receipt_id'])
            self.assertEqual(run('inventory')['revision'], 1)
            self.assertEqual(run('receipt', 'cli-dinner-20261104'), first)
            self.assertEqual(len(run('audit')['events']), 2)


if __name__ == '__main__': unittest.main()
