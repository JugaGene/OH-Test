#!/usr/bin/env python3
"""Local-only desk + Visma e-conomic proxy. Binds 127.0.0.1."""
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import os
import urllib.error
import urllib.request

ROOT = Path(__file__).resolve().parent
PORT = int(os.environ.get("PORT", "8765"))
HOST = "127.0.0.1"
ECO = "https://restapi.e-conomic.com"


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def log_message(self, fmt, *args):
        sys_stderr = __import__("sys").stderr
        sys_stderr.write("%s - %s\n" % (self.address_string(), fmt % args))

    def do_OPTIONS(self):
        if self.path.startswith("/eco/"):
            self.send_response(204)
            self._cors()
            self.end_headers()
            return
        super().do_OPTIONS()

    def _cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-AppSecretToken, X-AgreementGrantToken")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")

    def _proxy(self):
        dest = ECO + self.path[4:]  # strip /eco
        length = int(self.headers.get("Content-Length") or 0)
        body = self.rfile.read(length) if length else None
        headers = {
            "Content-Type": self.headers.get("Content-Type") or "application/json",
            "X-AppSecretToken": self.headers.get("X-AppSecretToken") or "",
            "X-AgreementGrantToken": self.headers.get("X-AgreementGrantToken") or "",
        }
        req = urllib.request.Request(dest, data=body, headers=headers, method=self.command)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                data = resp.read()
                self.send_response(resp.status)
                self._cors()
                self.send_header("Content-Type", resp.headers.get("Content-Type", "application/json"))
                self.send_header("Content-Length", str(len(data)))
                self.end_headers()
                self.wfile.write(data)
        except urllib.error.HTTPError as e:
            data = e.read()
            self.send_response(e.code)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(data)))
            self.end_headers()
            self.wfile.write(data)
        except Exception as e:
            msg = ('{"error":"%s"}' % str(e).replace('"', "'")).encode()
            self.send_response(502)
            self._cors()
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(msg)

    def do_GET(self):
        if self.path.startswith("/eco/"):
            return self._proxy()
        return super().do_GET()

    def do_POST(self):
        if self.path.startswith("/eco/"):
            return self._proxy()
        self.send_error(404)

    def do_PUT(self):
        if self.path.startswith("/eco/"):
            return self._proxy()
        self.send_error(404)


def main():
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"GreenPeas order desk — http://{HOST}:{PORT}")
    print("e-conomic proxy: http://{HOST}:{PORT}/eco/  (local only)")
    print("Do not deploy. Close this window to stop.")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
