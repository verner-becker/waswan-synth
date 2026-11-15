# SPDX-License-Identifier: GPL-3.0-only
"""Serve somente o simulador e seus avisos, no loopback local."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse
import json
import re
from threading import Lock
from urllib.parse import urlparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=8737)
parser.add_argument('--diagnostic-dir', type=Path, help='Diretório local de evidências (também permite testes isolados).')
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / '.local/www'
if not (root / 'simulator/obervave-voice.wasm').is_file():
    parser.error('Execute sh scripts/build-simulator.sh primeiro.')
validation = args.diagnostic_dir or Path(__file__).resolve().parents[1] / '.local/validation'
lock = Lock()

class Handler(SimpleHTTPRequestHandler):
    def do_POST(self):
        # Same-origin diagnostic batches only, served on loopback. No device names or notes are accepted.
        origin = urlparse(self.headers.get('Origin', ''))
        if self.path != '/diagnostics/midi':
            self.send_error(404); return
        if origin.scheme != 'http' or origin.hostname not in ('localhost', '127.0.0.1') or origin.port != args.port:
            self.send_error(403); return
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 131072: raise ValueError('batch size')
            body = json.loads(self.rfile.read(size))
            session, records = body['session'], body['records']
            if not isinstance(session, str) or not re.fullmatch(r'[0-9a-f-]{36}', session): raise ValueError('session')
            if not isinstance(records, list) or not 0 < len(records) <= 40: raise ValueError('records')
            allowed = {'type','seq','timestamp','elapsedMs','schema','limit','reason','label','raw','channel','cc','value','rawDelta',
                       'running','listening','profileEnabled','learning','target','mode','behavior','profilePrevious','profileContext',
                       'latestFrame','frameAgeMs','commands','context','parameters','disposition'}
            for record in records:
                if not isinstance(record, dict) or set(record) - allowed: raise ValueError('fields')
                if record.get('type') not in ('start','stop','reset','state','cc','marker'): raise ValueError('type')
                if not isinstance(record.get('seq'), int) or not 0 <= record['seq'] <= 10000: raise ValueError('seq')
                if record['type'] == 'cc':
                    raw = record.get('raw')
                    if not isinstance(raw, list) or len(raw) != 3 or not all(isinstance(v, int) for v in raw): raise ValueError('CC')
                    if not (176 <= raw[0] <= 191 and 0 <= raw[1] <= 127 and 0 <= raw[2] <= 127): raise ValueError('CC range')
            with lock:
                validation.mkdir(parents=True, exist_ok=True)
                path = validation / ('midi-live-' + session + '.jsonl')
                # Retries are idempotent: ignore records already appended, refuse gaps.
                existing = path.read_text().splitlines() if path.exists() else []
                expected = len(existing)
                pending = []
                for record in records:
                    if record['seq'] < expected: continue
                    if record['seq'] != expected: raise ValueError('sequence gap')
                    pending.append(json.dumps({'session': session, **record}, ensure_ascii=False) + '\n')
                    expected += 1
                with path.open('a') as output: output.writelines(pending)
                (validation / 'midi-live-current.json').write_text(json.dumps({'session': session, 'file': path.name, 'records': expected}))
        except (ValueError, KeyError, TypeError, UnicodeError):
            self.send_error(400); return
        self.send_response(204); self.end_headers()

server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(Handler, directory=str(root)))
print(f'Simulador: http://localhost:{args.port}/simulator/', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
