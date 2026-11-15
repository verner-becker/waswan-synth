# SPDX-License-Identifier: GPL-3.0-only
"""Serve somente o simulador e seus avisos, no loopback local."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--port', type=int, default=8737)
args = parser.parse_args()
root = Path(__file__).resolve().parents[1] / '.local/www'
if not (root / 'simulator/obervave-voice.wasm').is_file():
    parser.error('Execute sh scripts/build-simulator.sh primeiro.')
server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(SimpleHTTPRequestHandler, directory=str(root)))
print(f'Simulador: http://localhost:{args.port}/simulator/', flush=True)
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
