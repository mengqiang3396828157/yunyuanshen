#!/usr/bin/env python3
"""Local development server for Fingertip Bloom.

The page uses ES modules, a WASM runtime and a local MediaPipe model, so it must
be opened through HTTP rather than file://. This server adds the MIME types that
Windows often gets wrong for .mjs and .wasm, and disables caching while editing.
"""

from __future__ import annotations

import argparse
import contextlib
import functools
import http.server
import os
import socket
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent


class BloomHandler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".html": "text/html; charset=utf-8",
        ".css": "text/css; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".mjs": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".svg": "image/svg+xml",
        ".webp": "image/webp",
        ".woff2": "font/woff2",
    }

    def end_headers(self) -> None:
        self.send_header("Cache-Control", "no-store, no-cache, must-revalidate, max-age=0")
        self.send_header("Pragma", "no-cache")
        self.send_header("Expires", "0")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()

    def log_message(self, fmt: str, *args: object) -> None:
        sys.stderr.write("  %s\n" % (fmt % args))


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Serve Fingertip Bloom on localhost.")
    parser.add_argument("--port", type=int, default=8080, help="port to listen on (default: 8080)")
    parser.add_argument("--host", default="127.0.0.1", help="host to bind (default: 127.0.0.1)")
    parser.add_argument("--open", action="store_true", help="open the page in the default browser")
    return parser.parse_args()


def ensure_port_available(host: str, port: int) -> None:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            probe.bind((host, port))
        except OSError as exc:
            raise SystemExit(
                f"\n  Port {port} is already in use. Try: python server.py --port {port + 1}\n"
            ) from exc


def main() -> None:
    args = parse_args()
    ensure_port_available(args.host, args.port)

    os.chdir(ROOT)
    handler = functools.partial(BloomHandler, directory=str(ROOT))
    server = http.server.ThreadingHTTPServer((args.host, args.port), handler)
    server.daemon_threads = True

    url = f"http://{args.host}:{args.port}/"
    print()
    print("  *  FINGERTIP BLOOM  /  fingertip-bloom")
    print(f"  ->  {url}")
    print("  Ctrl+C to stop the server.")
    print()

    if args.open:
        threading.Timer(0.7, lambda: webbrowser.open(url)).start()

    try:
        with contextlib.suppress(KeyboardInterrupt):
            server.serve_forever()
    finally:
        server.server_close()
        print("\n  Server stopped.\n")


if __name__ == "__main__":
    main()
