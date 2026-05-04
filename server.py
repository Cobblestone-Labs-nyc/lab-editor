#!/usr/bin/env python3
"""Lab Editor static server with shared-layout persistence.

Run from the project directory:
    python3 server.py            # uses port 8124, layout file = ./layout.json
    PORT=9000 LAYOUT_FILE=/var/data/lab.json python3 server.py

Endpoints:
    GET  /api/layout    -> the current layout JSON (404 if no save yet)
    PUT  /api/layout    -> overwrite the layout from the request body (validated as JSON)
    *                   -> static files served from this directory

Concurrency model: last-write-wins. There's no locking, no merge, no auth.
For a small team where people aren't editing the same scene simultaneously this is fine.
"""
import http.server
import json
import os
import sys
import threading
from pathlib import Path

ROOT = Path(__file__).parent.resolve()
LAYOUT_PATH = Path(os.environ.get('LAYOUT_FILE', ROOT / 'layout.json')).resolve()
PORT = int(os.environ.get('PORT', '8124'))
HOST = os.environ.get('HOST', '0.0.0.0')

# Single-process write lock so concurrent PUTs don't tear the file.
_write_lock = threading.Lock()


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys.stderr.write('%s - %s\n' % (self.address_string(), fmt % args))

    def _send_json(self, status, payload):
        body = json.dumps(payload).encode('utf-8')
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split('?', 1)[0] == '/api/layout':
            if not LAYOUT_PATH.exists():
                self._send_json(404, {'error': 'no layout yet'})
                return
            data = LAYOUT_PATH.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()

    def do_PUT(self):
        if self.path != '/api/layout':
            self.send_error(404)
            return
        length = int(self.headers.get('Content-Length', '0'))
        if length <= 0 or length > 5_000_000:
            self.send_error(400, 'missing or oversized body')
            return
        body = self.rfile.read(length)
        try:
            json.loads(body)
        except Exception as e:
            self.send_error(400, f'invalid json: {e}')
            return
        with _write_lock:
            tmp = LAYOUT_PATH.with_suffix(LAYOUT_PATH.suffix + '.tmp')
            tmp.write_bytes(body)
            tmp.replace(LAYOUT_PATH)
        self.send_response(204)
        self.end_headers()


class ThreadingServer(http.server.ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    print(f'Lab Editor: http://{HOST}:{PORT}/  ·  layout file: {LAYOUT_PATH}')
    ThreadingServer((HOST, PORT), Handler).serve_forever()
