"""python -m pantry_relay: local workflow and explicitly configured service."""

import argparse
import ipaddress
import json
import os
from pathlib import Path
import sqlite3
import sys

from .core import Conflict, GateError, InputError, load_json
from .http_api import make_server
from .model import ModelError, select_recipes
from .store import Store


def main(argv=None):
    parser = argparse.ArgumentParser(description='Pantry Relay — sourced label gates and auditable stock use; no safety guarantee')
    parser.add_argument('--db', default='var/pantry.sqlite3')
    sub = parser.add_subparsers(dest='command', required=True)
    initialize = sub.add_parser('init'); initialize.add_argument('project')
    plan = sub.add_parser('plan'); plan.add_argument('--as-of'); plan.add_argument('--servings', type=int, default=1)
    consume = sub.add_parser('consume'); consume.add_argument('--recipe', required=True); consume.add_argument('--servings', type=int, default=1); consume.add_argument('--key', required=True); consume.add_argument('--expected-revision', type=int, required=True); consume.add_argument('--as-of')
    sub.add_parser('inventory'); sub.add_parser('audit')
    receipt = sub.add_parser('receipt'); receipt.add_argument('key')
    review = sub.add_parser('review'); review.add_argument('--lot', required=True); review.add_argument('--input', required=True)
    model = sub.add_parser('suggest'); model.add_argument('--prompt', required=True); model.add_argument('--as-of')
    serve = sub.add_parser('serve'); serve.add_argument('--host', default='127.0.0.1'); serve.add_argument('--port', type=int, default=8799)
    args = parser.parse_args(argv)
    try:
        store = Store(args.db)
        if args.command == 'init': result = store.initialize(load_json(args.project))
        elif args.command == 'plan': result = store.plan(args.as_of, args.servings)
        elif args.command == 'consume': result = store.consume(args.recipe, args.servings, args.key, at=args.as_of, expected_revision=args.expected_revision)
        elif args.command == 'inventory': result = store.inventory()
        elif args.command == 'audit': result = {'events': store.audit()}
        elif args.command == 'receipt': result = store.receipt(args.key)
        elif args.command == 'review': result = store.review_lot(args.lot, load_json(args.input))
        elif args.command == 'suggest':
            plan = store.plan(args.as_of); result = select_recipes(plan, args.prompt)
            current = store.plan(args.as_of)
            eligible = {candidate['recipe_id'] for candidate in current['candidates'] if candidate['can_consume']}
            if current['revision'] != plan['revision'] or not set(result['recipe_ids']) <= eligible: raise Conflict('Inventory or label timing changed during inference')
        else:
            try: local = ipaddress.ip_address(args.host).is_loopback
            except ValueError: local = args.host == 'localhost'
            if not local and os.environ.get('PANTRY_ALLOW_REMOTE') != '1': raise InputError('Remote bind requires explicit PANTRY_ALLOW_REMOTE=1 and a strong PANTRY_API_TOKEN')
            server = make_server((args.host, args.port), store, os.environ.get('PANTRY_API_TOKEN', ''))
            print(json.dumps({'listening': f'http://{args.host}:{server.server_port}', 'alipay_connected': False, 'model_default': 'off'}), flush=True)
            try: server.serve_forever()
            except KeyboardInterrupt: pass
            finally: server.server_close()
            return 0
        print(json.dumps(result, ensure_ascii=False, indent=2)); return 0
    except GateError as error:
        print(json.dumps({'error': 'GATED', 'candidate': error.candidate}, ensure_ascii=False), file=sys.stderr); return 2
    except (InputError, Conflict, ModelError, OSError, sqlite3.Error, ValueError) as error:
        print(json.dumps({'error': type(error).__name__, 'message': str(error)}, ensure_ascii=False), file=sys.stderr); return 2


if __name__ == '__main__': raise SystemExit(main())
