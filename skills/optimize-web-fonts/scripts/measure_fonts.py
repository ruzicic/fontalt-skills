#!/usr/bin/env python3
"""Step 1 - measure the current state.

Per font file: size, glyph count, variable axes, OpenType features, hinting, licence / Reserved Font Name.
Per page (when --base-url or --dir is given): font bytes actually downloaded, which font files, and what the page preloads.

  python3 measure_fonts.py --files public/fonts/*.woff2
  python3 measure_fonts.py --dir dist --paths / /blog/ --out measure.json
  python3 measure_fonts.py --base-url http://localhost:4321 --paths / /blog/
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import add_allow_remote_argument, launch_browser, new_context, page_url, require_local_url, serve_dir, settle, write_json  # noqa: E402
from fontinfo import font_facts  # noqa: E402


def measure_pages(base: str, paths: list[str], widths=(390, 1440), scheme="light") -> dict:
    from playwright.sync_api import sync_playwright
    out = {}
    with sync_playwright() as p:
        browser = launch_browser(p)
        for width in widths:
            for path in paths:
                ctx = new_context(browser, width, scheme)
                page = ctx.new_page()
                fonts: dict[str, int] = {}

                def on_response(resp, fonts=fonts):
                    try:
                        if resp.request.resource_type == "font" or resp.url.split("?")[0].lower().endswith((".woff2", ".woff", ".ttf", ".otf")):
                            fonts[resp.url] = len(resp.body())
                    except Exception:
                        pass

                page.on("response", on_response)
                page.goto(page_url(base, path), wait_until="load")
                settle(page)
                preloads = page.evaluate("""[...document.querySelectorAll('link[rel~=preload][as=font]')].map(l=>l.href)""")
                out[f"{path}@{width}"] = {
                    "path": path, "viewport": width,
                    "font_files": {u.replace(base, ""): b for u, b in sorted(fonts.items())},
                    "font_bytes": sum(fonts.values()),
                    "preloads": sorted(u.replace(base, "") for u in preloads),
                }
                ctx.close()
        browser.close()
    return out


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--files", nargs="*", default=[], help="font files to inspect")
    ap.add_argument("--base-url")
    ap.add_argument("--dir", help="built static directory; served on a temporary localhost port")
    ap.add_argument("--paths", nargs="*", default=["/"])
    ap.add_argument("--widths", nargs="*", type=int, default=[390, 1440])
    ap.add_argument("--out")
    add_allow_remote_argument(ap)
    a = ap.parse_args(argv)
    if a.base_url:
        a.base_url = require_local_url(a.base_url, allow_remote=a.allow_remote, flag="--base-url")

    result: dict = {"fonts": [font_facts(f) for f in a.files]}
    if a.base_url:
        result["pages"] = measure_pages(a.base_url, a.paths, a.widths)
    elif a.dir:
        with serve_dir(a.dir) as base:
            result["pages"] = measure_pages(base, a.paths, a.widths)

    for f in result["fonts"]:
        axes = ", ".join(f"{x['tag']} {x['min']:g}-{x['max']:g}" for x in f["axes"]) or "static"
        feats = sorted({t for v in f["features"].values() for t in v})
        print(f"{f['file']}: {f['bytes']:,} B  {f['glyphs']} glyphs  axes[{axes}]  {len(feats)} features  hinted={f['hinted']}  RFN={f['reserved_font_names'] or '-'}")
    for k, v in result.get("pages", {}).items():
        print(f"{k}: {v['font_bytes']:,} B in {len(v['font_files'])} font file(s); preloads={v['preloads'] or 'none'}")
    if a.out:
        write_json(a.out, result)
    return result


if __name__ == "__main__":
    main()
