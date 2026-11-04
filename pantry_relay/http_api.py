"""Authenticated local JSON API. No merchant, payment, or private Alipay endpoint."""

import hmac
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
from urllib.parse import urlsplit

from .core import Conflict, GateError, InputError, fields, parse_json
from .model import ModelError, select_recipes


def make_server(address, store, api_token):
    if not isinstance(api_token, str) or len(api_token) < 32 or not api_token.isascii(): raise InputError('PANTRY_API_TOKEN must contain at least 32 ASCII characters')
    specification = json.loads((Path(__file__).resolve().parent/'openapi.json').read_text())

    class Handler(BaseHTTPRequestHandler):
        server_version = 'PantryRelay/1.0'

        def setup(self):
            super().setup(); self.connection.settimeout(10)

        def log_message(self, *_args):
            pass  # No household data, request URLs, or Authorization headers in logs.

        def reply(self, status, body):
            raw = json.dumps(body, ensure_ascii=False, allow_nan=False).encode()
            self.send_response(status)
            for key, value in {'Content-Type': 'application/json; charset=utf-8', 'Content-Length': str(len(raw)), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'}.items(): self.send_header(key, value)
            self.end_headers(); self.wfile.write(raw)

        def body(self):
            if self.headers.get('Transfer-Encoding') or len(self.headers.get_all('Content-Length', [])) != 1: raise InputError('Exactly one Content-Length is required')
            if self.headers.get_content_type() != 'application/json': raise InputError('Content-Type must be application/json')
            try: size = int(self.headers['Content-Length'])
            except (ValueError, TypeError): raise InputError('Invalid Content-Length') from None
            if not 1 <= size <= 1_000_000: raise InputError('Body must contain 1–1,000,000 bytes')
            value = parse_json(self.rfile.read(size))
            if not isinstance(value, dict): raise InputError('Body must be an object')
            return value

        def dispatch(self):
            url = urlsplit(self.path)
            if url.query: raise InputError('Query parameters are not supported; the HTTP API always uses server time')
            if self.command == 'GET' and url.path == '/health': return self.reply(200, {'status': 'ok', 'service': 'pantry-relay', 'default_engine': 'deterministic', 'alipay_connected': False})
            if self.command == 'GET' and url.path == '/openapi.json': return self.reply(200, specification)
            auth = self.headers.get('Authorization', '')
            if not auth.isascii() or not hmac.compare_digest(auth, 'Bearer ' + api_token): return self.reply(401, {'code': 'UNAUTHORIZED'})
            if self.command == 'GET' and url.path == '/v1/inventory': return self.reply(200, store.inventory())
            if self.command == 'GET' and url.path == '/v1/plan': return self.reply(200, store.plan())
            if self.command == 'GET' and url.path == '/v1/audit': return self.reply(200, {'events': store.audit()})
            receipt_match = re.fullmatch(r'/v1/receipts/([A-Za-z0-9_-]{12,128})', url.path)
            if self.command == 'GET' and receipt_match: return self.reply(200, store.receipt(receipt_match.group(1)))
            if self.command == 'POST' and url.path == '/v1/consume':
                body = self.body(); fields(body, {'recipe_id', 'servings', 'expected_revision'}, name='consumption request')
                if type(body['expected_revision']) is not int or body['expected_revision'] < 0: raise InputError('expected_revision is required and must be a nonnegative integer')
                return self.reply(200, store.consume(body['recipe_id'], body['servings'], self.headers.get('Idempotency-Key'), expected_revision=body['expected_revision']))
            review_match = re.fullmatch(r'/v1/lots/([a-z][a-z0-9_-]{0,63})/review', url.path)
            if self.command == 'POST' and review_match: return self.reply(200, store.review_lot(review_match.group(1), self.body()))
            if self.command == 'POST' and url.path == '/v1/model-suggest':
                body = self.body(); fields(body, {'prompt'}, name='model request')
                plan = store.plan(); result = select_recipes(plan, body['prompt'])
                current = store.plan()
                eligible = {candidate['recipe_id'] for candidate in current['candidates'] if candidate['can_consume']}
                if current['revision'] != plan['revision'] or not set(result['recipe_ids']) <= eligible: raise Conflict('Stock or label timing changed during inference; request a new selection')
                return self.reply(200, result)
            return self.reply(404, {'code': 'NOT_FOUND'})

        def handle_request(self):
            try: self.dispatch()
            except GateError as error: self.reply(409, {'code': 'REVIEW_OR_STOCK_REQUIRED', 'message': str(error), 'candidate': error.candidate})
            except Conflict as error: self.reply(409, {'code': 'CONFLICT', 'message': str(error)})
            except InputError as error: self.reply(400, {'code': 'INVALID_INPUT', 'message': str(error)})
            except ModelError as error: self.reply(503, {'code': 'LOCAL_MODEL_UNAVAILABLE', 'message': str(error), 'inventory_changed': False})
            except Exception: self.reply(503, {'code': 'SERVICE_UNAVAILABLE', 'message': 'No partial consumption was committed. Retry with the same idempotency key.'})

        do_GET = handle_request
        do_POST = handle_request

    return ThreadingHTTPServer(address, Handler)
