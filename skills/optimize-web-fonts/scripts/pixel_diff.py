#!/usr/bin/env python3
"""Step 4 - prove nothing changed: Playwright screenshots before/after, pixel diff, and CLS with fonts delayed.

Serves the two built directories on temporary localhost ports (or pass --before-url/--after-url for dev servers),
screenshots every page at every viewport and colour scheme (animations off, fonts ready, lazy images loaded),
counts differing pixels, groups them into clusters, and names the element under each cluster so every difference
can be explained (content change / regression / sub-pixel rounding). Also measures layout shift with every font
response delayed 1.5 s, before vs after.

  python3 pixel_diff.py --before-dir work/before/dist --after-dir work/after/dist \
      --paths / /blog/ --out work/diff
  python3 pixel_diff.py --before-dir A --after-dir A --paths / --out work/noise     # noise floor: must be 0 px

Verdict per page: PASS (0 px), TOLERATED (<= 0.02 % of pixels, max channel delta <= 16: each cluster is listed with its
element so you can explain it), FAIL (anything else, including a changed page height or CLS > 0.1 / worse than +0.01).
"""
from __future__ import annotations

import argparse
import asyncio
import contextlib
import io
import sys
from pathlib import Path

import numpy as np
from playwright.sync_api import TimeoutError as PlaywrightTimeout
from PIL import Image

sys.path.insert(0, str(Path(__file__).parent))
from common import launch_browser, new_context, page_url, serve_dir, settle, write_json  # noqa: E402

TOLERANCE_PCT = 0.02
MAX_DELTA = 16


def shoot(browser, base, path, width, scheme, attempts=3) -> bytes:
    """Screenshot one page; retries a screenshot timeout (a loaded machine can stall Chromium) with a fresh context."""
    for attempt in range(attempts):
        ctx = new_context(browser, width, scheme)
        try:
            page = ctx.new_page()
            page.goto(page_url(base, path), wait_until="load")
            settle(page)
            return page.screenshot(full_page=True, animations="disabled", scale="css", timeout=90_000)
        except PlaywrightTimeout:
            if attempt == attempts - 1:
                raise
            print(f"  screenshot timeout on {path}@{width}, retrying", file=sys.stderr)
        finally:
            ctx.close()


def clusters_of(mask: np.ndarray, limit=2000):
    ys, xs = np.nonzero(mask)
    pts = set(zip(ys.tolist(), xs.tolist()))
    seen, out = set(), []
    for pt in pts:
        if pt in seen:
            continue
        stack, comp = [pt], []
        seen.add(pt)
        while stack and len(comp) < limit:
            y, x = stack.pop()
            comp.append((y, x))
            for dy in (-1, 0, 1):
                for dx in (-1, 0, 1):
                    n = (y + dy, x + dx)
                    if n in pts and n not in seen:
                        seen.add(n)
                        stack.append(n)
        cy = [c[0] for c in comp]
        cx = [c[1] for c in comp]
        out.append({"pixels": len(comp), "bbox": [min(cx), min(cy), max(cx), max(cy)]})
    return sorted(out, key=lambda c: -c["pixels"])


def compare(before_png: bytes, after_png: bytes) -> tuple[dict, np.ndarray | None]:
    a = Image.open(io.BytesIO(before_png)).convert("RGB")
    b = Image.open(io.BytesIO(after_png)).convert("RGB")
    res = {"before_size": list(a.size), "after_size": list(b.size)}
    if a.size != b.size:
        res.update(differing_pixels=None, status="FAIL", reason=f"page size changed {a.size} -> {b.size}")
        return res, None
    x, y = np.asarray(a, dtype=np.int16), np.asarray(b, dtype=np.int16)
    delta = np.abs(x - y).max(axis=2)
    mask = delta > 0
    n = int(mask.sum())
    total = a.size[0] * a.size[1]
    res.update(differing_pixels=n, total_pixels=total, differing_pct=round(100 * n / total, 5), max_channel_delta=int(delta.max()))
    if n:
        cl = clusters_of(mask)
        res["clusters"] = len(cl)
        res["largest_cluster_px"] = cl[0]["pixels"] if cl else 0
        res["cluster_list"] = cl[:25]
    return res, (mask if n else None)


def describe_regions(browser, base, path, width, scheme, cluster_list):
    ctx = new_context(browser, width, scheme)
    page = ctx.new_page()
    page.goto(page_url(base, path), wait_until="load")
    settle(page)
    out = []
    for c in cluster_list[:12]:
        x0, y0, x1, y1 = c["bbox"]
        cx, cy = (x0 + x1) // 2, (y0 + y1) // 2
        info = page.evaluate("""([x,y])=>{window.scrollTo(0,Math.max(0,y-300));
          const el=document.elementFromPoint(x-scrollX,y-scrollY); if(!el) return null;
          const cs=getComputedStyle(el);
          return {tag:el.tagName.toLowerCase(), cls:el.className&&el.className.toString().slice(0,60), text:(el.textContent||'').trim().slice(0,80),
                  font:cs.fontFamily.slice(0,80), weight:cs.fontWeight, style:cs.fontStyle, size:cs.fontSize};}""", [cx, cy])
        out.append({**c, "element": info})
    ctx.close()
    return out


async def cls_run(base, path, width, scheme, delay_ms, exe=None) -> float:
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        kw = {"args": ["--font-render-hinting=none", "--disable-lcd-text"]}
        if exe:
            kw["executable_path"] = exe
        browser = await p.chromium.launch(**kw)
        ctx = await browser.new_context(viewport={"width": width, "height": 900}, color_scheme=scheme, reduced_motion="reduce",
                                        locale="en-US", timezone_id="UTC", service_workers="block")
        await ctx.add_init_script("""window.__cls=0;new PerformanceObserver(l=>{for(const e of l.getEntries()) if(!e.hadRecentInput) window.__cls+=e.value;}).observe({type:'layout-shift',buffered:true});""")
        page = await ctx.new_page()

        async def delay_font(route):
            resp = await route.fetch()
            await asyncio.sleep(delay_ms / 1000)
            await route.fulfill(response=resp)

        if delay_ms:
            await page.route(lambda u: u.split("?")[0].lower().endswith((".woff2", ".woff", ".ttf", ".otf")), delay_font)
        await page.goto(page_url(base, path), wait_until="load")
        await page.wait_for_timeout(400)
        await page.evaluate("document.fonts.ready.then(()=>true)")
        await page.wait_for_timeout(900)
        v = await page.evaluate("window.__cls")
        await browser.close()
        return round(v, 5)


def main(argv=None):
    import os
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--before-dir"); ap.add_argument("--after-dir")
    ap.add_argument("--before-url"); ap.add_argument("--after-url")
    ap.add_argument("--paths", nargs="*", default=["/"])
    ap.add_argument("--widths", nargs="*", type=int, default=[390, 1440])
    ap.add_argument("--schemes", nargs="*", default=["light"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--no-cls", action="store_true")
    ap.add_argument("--cls-delay-ms", type=int, default=1500)
    ap.add_argument("--keep-images", action="store_true", help="always write before/after PNGs (default: only diff images for failures)")
    a = ap.parse_args(argv)
    out = Path(a.out)
    (out / "img").mkdir(parents=True, exist_ok=True)

    with contextlib.ExitStack() as stack:
        b_base = a.before_url or stack.enter_context(serve_dir(a.before_dir))
        a_base = a.after_url or stack.enter_context(serve_dir(a.after_dir))
        from playwright.sync_api import sync_playwright
        pages = {}
        with sync_playwright() as p:
            browser = launch_browser(p)
            for scheme in a.schemes:
                for width in a.widths:
                    for path in a.paths:
                        key = f"{path}@{width}@{scheme}"
                        slug = key.replace("/", "_").replace("@", "-").strip("_") or "root"
                        bpng = shoot(browser, b_base, path, width, scheme)
                        apng = shoot(browser, a_base, path, width, scheme)
                        res, mask = compare(bpng, apng)
                        if a.keep_images:
                            (out / "img" / f"{slug}-before.png").write_bytes(bpng)
                            (out / "img" / f"{slug}-after.png").write_bytes(apng)
                        if mask is not None:
                            res["cluster_list"] = describe_regions(browser, a_base, path, width, scheme, res["cluster_list"])
                            im = Image.open(io.BytesIO(apng)).convert("RGB")
                            arr = (np.asarray(im, dtype=np.float32) * 0.35 + 255 * 0.65).astype(np.uint8)
                            arr[mask] = (255, 0, 0)
                            Image.fromarray(arr).save(out / "img" / f"{slug}-diff.png")
                            (out / "img" / f"{slug}-before.png").write_bytes(bpng)
                            (out / "img" / f"{slug}-after.png").write_bytes(apng)
                        n = res.get("differing_pixels")
                        if n == 0:
                            res["status"] = "PASS"
                        elif n is not None:
                            ok = res["differing_pct"] <= TOLERANCE_PCT and res["max_channel_delta"] <= MAX_DELTA
                            res["status"] = "TOLERATED" if ok else "FAIL"
                        pages[key] = res
                        print(f"{key}: {res['status']}  diff px={n}  size={res['after_size']}")
            browser.close()
        if not a.no_cls:
            exe = os.environ.get("FONT_SKILLS_CHROMIUM")
            for scheme in a.schemes[:1]:
                for width in a.widths:
                    for path in a.paths:
                        key = f"{path}@{width}@{scheme}"
                        cb = asyncio.run(cls_run(b_base, path, width, scheme, a.cls_delay_ms, exe))
                        ca = asyncio.run(cls_run(a_base, path, width, scheme, a.cls_delay_ms, exe))
                        ok = ca <= 0.1 and ca <= cb + 0.01
                        pages[key]["cls_before"], pages[key]["cls_after"], pages[key]["cls_ok"] = cb, ca, ok
                        if not ok:
                            pages[key]["status"] = "FAIL"
                            pages[key]["reason"] = f"CLS before {cb} after {ca}"
                        print(f"{key}: CLS before={cb} after={ca} {'ok' if ok else 'FAIL'}")
    summary = {
        "pages": len(pages),
        "pass": sum(1 for r in pages.values() if r["status"] == "PASS"),
        "tolerated": sum(1 for r in pages.values() if r["status"] == "TOLERATED"),
        "fail": sum(1 for r in pages.values() if r["status"] == "FAIL"),
        "total_differing_pixels": sum(r.get("differing_pixels") or 0 for r in pages.values()),
        "max_cls_after": max((r.get("cls_after", 0) for r in pages.values()), default=None),
    }
    write_json(out / "pixel_diff.json", {"summary": summary, "pages": pages, "tolerance_pct": TOLERANCE_PCT})
    print("summary:", summary)
    sys.exit(1 if summary["fail"] else 0)


if __name__ == "__main__":
    main()
