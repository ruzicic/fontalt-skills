#!/usr/bin/env python3
"""URL guard for --base-url / --before-url / --after-url (Snyk W011)."""
from __future__ import annotations

import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "skills" / "optimize-web-fonts" / "scripts"
sys.path.insert(0, str(SCRIPTS))
from common import require_local_url  # noqa: E402


class TestRequireLocalUrl(unittest.TestCase):
    def allow(self, url: str) -> None:
        self.assertEqual(require_local_url(url, flag="--base-url"), url)

    def reject(self, url: str) -> None:
        with self.assertRaises(SystemExit) as cm:
            require_local_url(url, allow_remote=False, flag="--base-url")
        msg = cm.exception.code
        self.assertIsInstance(msg, str)
        self.assertIn("--base-url", msg)
        self.assertIn("local URL", msg)

    def test_allow_localhost(self):
        self.allow("http://localhost")
        self.allow("http://localhost:4321")
        self.allow("https://localhost:4321")

    def test_allow_loopback_ipv4(self):
        self.allow("http://127.0.0.1:4321")
        self.allow("http://127.0.0.1")
        self.allow("http://127.255.255.255")

    def test_allow_loopback_ipv6(self):
        self.allow("http://[::1]")
        self.allow("http://[::1]:4321")

    def test_allow_file(self):
        self.allow("file:///tmp/site/index.html")
        self.allow("file://localhost/tmp/site")

    def test_reject_example_com(self):
        self.reject("http://example.com")
        self.reject("https://example.com/path")

    def test_reject_userinfo_trick(self):
        self.reject("http://localhost@evil.com")

    def test_reject_localhost_subdomain(self):
        self.reject("http://localhost.evil.com")

    def test_reject_remote_without_allow_remote(self):
        self.reject("https://fonts.googleapis.com")
        self.reject("http://example.com:4321")

    def test_allow_remote_opt_in(self):
        url = "https://example.com"
        self.assertEqual(require_local_url(url, allow_remote=True, flag="--base-url"), url)


if __name__ == "__main__":
    unittest.main()
