"""Shared helpers for the optimize-web-fonts scripts (stdlib + fonttools + Playwright)."""
from __future__ import annotations

import argparse
import contextlib
import functools
import http.server
import ipaddress
import json
import os
import socketserver
import sys
import threading
from pathlib import Path
from urllib.parse import urlparse

CORE_PUNCT = [0x00A0, 0x2013, 0x2014, 0x2018, 0x2019, 0x201C, 0x201D, 0x2026]
CORE_BASE = set(range(0x20, 0x7F)) | set(CORE_PUNCT)
LATIN1 = set(range(0xA0, 0x100))
LATIN_EXT_A = set(range(0x100, 0x180))
WANTED_SPECIAL = {0x2010}  # hyphens: auto draws U+2010


def ranges_from_codepoints(cps) -> list[tuple[int, int]]:
    out: list[tuple[int, int]] = []
    for cp in sorted(set(cps)):
        if out and cp == out[-1][1] + 1:
            out[-1] = (out[-1][0], cp)
        else:
            out.append((cp, cp))
    return out


def unicode_range_css(cps) -> str:
    parts = []
    for a, b in ranges_from_codepoints(cps):
        parts.append(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}")
    return ", ".join(parts)


def parse_unicode_range(text: str | None) -> list[tuple[int, int]]:
    """Parse a CSS unicode-range descriptor. None/empty means 'all code points'."""
    if not text:
        return [(0, 0x10FFFF)]
    out = []
    for part in text.split(","):
        part = part.strip().upper().removeprefix("U+")
        if not part:
            continue
        if "?" in part:
            out.append((int(part.replace("?", "0"), 16), int(part.replace("?", "F"), 16)))
        elif "-" in part:
            a, b = part.split("-", 1)
            out.append((int(a, 16), int(b, 16)))
        else:
            out.append((int(part, 16), int(part, 16)))
    return out


def in_ranges(cp: int, ranges) -> bool:
    return any(a <= cp <= b for a, b in ranges)


def write_json(path, data) -> None:
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    Path(path).write_text(json.dumps(data, indent=2, sort_keys=True, ensure_ascii=False) + "\n", encoding="utf-8")


def read_json(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))


MIME = {
    ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".otf": "font/otf",
    ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
    ".html": "text/html; charset=utf-8", ".svg": "image/svg+xml", ".json": "application/json",
    ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".txt": "text/plain; charset=utf-8",
    ".xml": "application/xml", ".ico": "image/x-icon", ".avif": "image/avif",
}


class _Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {**http.server.SimpleHTTPRequestHandler.extensions_map, **MIME}

    def log_message(self, *a):  # quiet
        pass

    def guess_type(self, path):
        ext = os.path.splitext(path)[1].lower()
        return MIME.get(ext, "application/octet-stream")

    def translate_path(self, path):
        p = super().translate_path(path)
        # static-export style routing: /about -> /about/index.html or /about.html
        if not os.path.exists(p) and not os.path.splitext(p)[1]:
            if os.path.exists(p + ".html"):
                return p + ".html"
        return p

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()


class _Server(socketserver.ThreadingMixIn, http.server.HTTPServer):
    daemon_threads = True
    allow_reuse_address = True


@contextlib.contextmanager
def serve_dir(directory):
    """Serve a built static directory on a free localhost port; yields the base URL.

    The server runs in a thread of this process, so nothing is left running afterwards.
    """
    handler = functools.partial(_Handler, directory=str(directory))
    srv = _Server(("127.0.0.1", 0), handler)
    t = threading.Thread(target=srv.serve_forever, daemon=True)
    t.start()
    try:
        yield f"http://127.0.0.1:{srv.server_address[1]}"
    finally:
        srv.shutdown()
        srv.server_close()


def launch_browser(p):
    """Launch Chromium. Honors FONT_SKILLS_CHROMIUM=/path/to/chrome if the cached build differs."""
    exe = os.environ.get("FONT_SKILLS_CHROMIUM")
    kw = {"args": ["--font-render-hinting=none", "--disable-lcd-text", "--force-color-profile=srgb"]}
    if exe:
        kw["executable_path"] = exe
    return p.chromium.launch(**kw)


def new_context(browser, width, scheme="light", **kw):
    return browser.new_context(
        viewport={"width": width, "height": 900}, device_scale_factor=1, color_scheme=scheme,
        reduced_motion="reduce", locale="en-US", timezone_id="UTC", service_workers="block", **kw)


NO_MOTION_CSS = ("*,*::before,*::after{animation:none!important;transition:none!important;"
                 "caret-color:transparent!important;scroll-behavior:auto!important}")


def settle(page, extra_ms=250):
    """Wait for load, webfonts, lazy images and two animation frames."""
    page.wait_for_load_state("load")
    try:
        page.wait_for_load_state("networkidle", timeout=8000)
    except Exception:
        pass
    page.add_style_tag(content=NO_MOTION_CSS)
    page.evaluate("document.fonts.ready.then(()=>true)")
    page.evaluate("""async()=>{const h=document.documentElement.scrollHeight;
      for(let y=0;y<h;y+=600){window.scrollTo(0,y);await new Promise(r=>setTimeout(r,30));}
      window.scrollTo(0,0);
      await Promise.all([...document.images].filter(i=>!i.complete).map(i=>new Promise(r=>{i.onload=i.onerror=r;})));
      await document.fonts.ready;
      await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));}""")
    page.wait_for_timeout(extra_ms)


def _is_loopback_host(host: str) -> bool:
    """True for 'localhost', 127.0.0.0/8, or ::1. Does not resolve DNS."""
    if not host:
        return False
    name = host.strip().lower().rstrip(".")
    if name == "localhost":
        return True
    try:
        return ipaddress.ip_address(name).is_loopback
    except ValueError:
        return False


def require_local_url(url: str, *, allow_remote: bool = False, flag: str = "URL") -> str:
    """Allow only loopback hosts or file://, unless allow_remote is True.

    Parses with urllib.parse. Rejects userinfo tricks such as http://localhost@evil.com.
    Exits with a clear error on anything else.
    """
    raw = (url or "").strip()
    if not raw:
        sys.exit(f"error: {flag} is empty")
    if allow_remote:
        return raw
    try:
        parsed = urlparse(raw)
    except ValueError:
        sys.exit(f"error: {flag} is not a valid URL: {raw}")
    scheme = (parsed.scheme or "").lower()
    if scheme == "file":
        return raw
    if parsed.username is not None or parsed.password is not None:
        sys.exit(
            f"error: {flag} must be a local URL (localhost, 127.0.0.0/8, ::1, or file://); "
            f"userinfo is not allowed. Pass --allow-remote to open a non-local URL. Got: {raw}"
        )
    if scheme in ("http", "https") and _is_loopback_host(parsed.hostname or ""):
        return raw
    sys.exit(
        f"error: {flag} must be a local URL (localhost, 127.0.0.0/8, ::1, or file://). "
        f"Pass --allow-remote to open a non-local URL. Got: {raw}"
    )


def add_allow_remote_argument(ap: argparse.ArgumentParser) -> None:
    ap.add_argument(
        "--allow-remote",
        action="store_true",
        help="allow --base-url / --before-url / --after-url to point at a non-local host",
    )


def page_url(base: str, path: str) -> str:
    return base.rstrip("/") + "/" + path.lstrip("/") if path != "/" else base.rstrip("/") + "/"
