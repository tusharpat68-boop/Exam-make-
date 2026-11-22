"""Local HTTP math verification service (standard library only, plus SymPy for the checks).

Run from the project root:   python3 -m mathsvc.server
Binds to 127.0.0.1 only and requires the X-Math-Token header to match MATH_SERVICE_TOKEN.
Single-threaded on purpose: the per-request alarm timeout needs the main thread.
"""
import hmac
import json
import os
import signal
import sys
from http.server import BaseHTTPRequestHandler, HTTPServer

from . import verifier
from .status import ComputeTimeout, NEEDS_MANUAL_REVIEW, result

TOKEN = os.environ.get('MATH_SERVICE_TOKEN', '')
TIMEOUT = max(1, int(os.environ.get('MATH_TIMEOUT', '8')))
PORT = int(os.environ.get('MATH_PORT', '5001'))
MAX_BODY = 20000


def _on_alarm(signum, frame):
    raise ComputeTimeout()


class Handler(BaseHTTPRequestHandler):
    server_version = 'MathSvc'

    def log_message(self, fmt, *args):  # keep logs short, never log request bodies
        sys.stderr.write('%s %s\n' % (self.command, self.path))

    def _send(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _authorized(self):
        got = self.headers.get('X-Math-Token', '')
        return hmac.compare_digest(got.encode(), TOKEN.encode())

    def do_GET(self):
        if self.path == '/health':
            return self._send(200, {'ok': True, 'sympy': verifier.sp is not None})
        self._send(404, {'ok': False})

    def do_POST(self):
        if self.path != '/verify':
            return self._send(404, {'ok': False})
        if not self._authorized():
            return self._send(401, {'ok': False, 'error': 'unauthorized'})
        try:
            length = int(self.headers.get('Content-Length', '0'))
        except ValueError:
            length = -1
        if length <= 0 or length > MAX_BODY:
            return self._send(400, {'ok': False, 'error': 'bad body size'})
        try:
            req = json.loads(self.rfile.read(length))
        except ValueError:
            return self._send(400, {'ok': False, 'error': 'invalid JSON'})
        signal.alarm(TIMEOUT)
        try:
            out = verifier.verify(req)
        except ComputeTimeout:
            out = result(NEEDS_MANUAL_REVIEW, str(req.get('kind', ''))[:30] if isinstance(req, dict) else '',
                         'Verification took too long; please review manually.')
        finally:
            signal.alarm(0)
        self._send(200, out)


def main():
    if not TOKEN:
        sys.exit('MATH_SERVICE_TOKEN is not set. Put the same value in .env for both services.')
    signal.signal(signal.SIGALRM, _on_alarm)
    if verifier.sp is None:
        print('WARNING: SymPy is not installed; only "statistics" can be verified. pip install sympy', file=sys.stderr)
    srv = HTTPServer(('127.0.0.1', PORT), Handler)
    print(f'Math service on 127.0.0.1:{PORT}')
    srv.serve_forever()


if __name__ == '__main__':
    main()
