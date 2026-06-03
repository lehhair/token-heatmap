#!/usr/bin/env python3
from __future__ import annotations

import os
import subprocess
import sys
from http.server import HTTPServer, SimpleHTTPRequestHandler

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8080"))


class Handler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/sync":
            self._do_sync()
            return
        if self.path == "/":
            self.path = "/index.html"
        super().do_GET()

    def _do_sync(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/plain; charset=utf-8")
        self.end_headers()
        try:
            result = subprocess.run(
                [sys.executable, "sync.py"],
                capture_output=True,
                text=True,
                cwd=os.path.dirname(os.path.abspath(__file__)),
            )
            output = result.stdout
            if result.returncode != 0:
                output += "\nERROR: " + result.stderr
            self.wfile.write(output.encode("utf-8"))
        except Exception as e:
            self.wfile.write(f"Sync failed: {e}".encode("utf-8"))

    def log_message(self, format, *args):
        print(f"[{self.log_date_time_string()}] {args[0]} {args[1]} {args[2]}")


def main():
    import argparse
    parser = argparse.ArgumentParser(description="OpenCode Heatmap Dev Server")
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=PORT)
    parser.add_argument("--sync", action="store_true", help="Run sync before starting server")
    args = parser.parse_args()

    repo_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(repo_dir)

    if args.sync:
        print("Running sync...")
        subprocess.run([sys.executable, "sync.py"], cwd=repo_dir)

    server = HTTPServer((args.host, args.port), Handler)
    print(f"Serving at http://{args.host}:{args.port}")
    print("  /         - Heatmap page")
    print("  /sync     - Trigger data sync")
    print("  Ctrl+C    - Stop")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nShutting down")
        server.server_close()


if __name__ == "__main__":
    main()
