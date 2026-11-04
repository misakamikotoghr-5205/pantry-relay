#!/usr/bin/env python3
"""Local verification with no paid APIs, downloads, or actual model inference."""

from datetime import datetime, timezone
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


def main():
    suite = unittest.defaultTestLoader.discover(str(ROOT / 'tests'))
    result = unittest.TextTestRunner(verbosity=2).run(suite)
    if not result.wasSuccessful(): return 1
    if (ROOT / 'openapi.json').read_bytes() != (ROOT / 'pantry_relay/openapi.json').read_bytes():
        raise RuntimeError('Public and packaged OpenAPI specifications differ')
    output = ROOT / 'output'; output.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix='pantry-verification-') as directory:
        database = str(Path(directory) / 'pantry.sqlite3')
        def cli(*arguments):
            completed = subprocess.run([sys.executable, '-m', 'pantry_relay', '--db', database, *arguments], cwd=ROOT, check=True, capture_output=True, text=True)
            return json.loads(completed.stdout)
        cli('init', str(ROOT / 'examples/pantry.json'))
        now = '2026-11-04T12:00:00+08:00'
        plan = cli('plan', '--as-of', now)
        arguments = ('consume', '--recipe', 'tomato_eggs', '--key', 'verify-dinner-20261104', '--expected-revision', '0', '--as-of', now)
        receipt = cli(*arguments); replay = cli(*arguments)
        inventory = cli('inventory')
        assert receipt['receipt_id'] == replay['receipt_id'] and replay['replayed']
        assert inventory['revision'] == 1
        assert receipt['changes'][0]['lot_id'] == 'tomato_open' and receipt['changes'][0]['remaining'] == '0'
        for name, value in [('plan', plan), ('receipt', receipt), ('inventory', inventory)]:
            (output / (name + '.json')).write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n')
    verification = {'checked_at': datetime.now(timezone.utc).isoformat(), 'test_count': result.testsRun,
                    'tests_passed': True, 'actual_cli_workflow': 'init -> preview -> consume -> idempotent replay -> inventory',
                    'http_tests': 'loopback HTTP server, authentication, current-time gates and transactional consumption',
                    'model_tests': 'mock transport and local fake HTTP server only; proxy bypass and redirect rejection included',
                    'actual_model_inference_performed': False, 'alipay_connected': False, 'deployed': False,
                    'fixture_data': 'fictional, frozen at 2026-11-04T12:00:00+08:00'}
    (output / 'verification.json').write_text(json.dumps(verification, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps(verification, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__': raise SystemExit(main())
