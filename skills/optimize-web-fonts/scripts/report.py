#!/usr/bin/env python3
"""Step 6 - bytes-saved report (markdown + json) from the earlier steps' outputs.

  python3 report.py --before measure-before.json --after measure-after.json \\
      --manifest fonts-out/manifest.json --diff pixel-diff/pixel_diff.json --out report
"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import read_json, write_json  # noqa: E402


def pct(before: int, after: int) -> float:
    return round(100 * (before - after) / before, 1) if before else 0.0


def build(before: dict, after: dict, manifest: dict | None, diff: dict | None) -> dict:
    rows = []
    for key, b in before["pages"].items():
        a = after["pages"].get(key)
        if not a:
            continue
        rows.append({"page": key, "before_bytes": b["font_bytes"], "after_bytes": a["font_bytes"],
                     "saved_pct": pct(b["font_bytes"], a["font_bytes"]),
                     "files_before": len(b["font_files"]), "files_after": len(a["font_files"]),
                     "preloads_before": b["preloads"], "preloads_after": a["preloads"]})
    tb, ta = sum(r["before_bytes"] for r in rows), sum(r["after_bytes"] for r in rows)
    out = {"pages": rows, "total_before_bytes": tb, "total_after_bytes": ta, "total_saved_pct": pct(tb, ta)}
    if manifest:
        out["files"] = [{"source": f["source"], "bytes_before": f["before"]["bytes"],
                         "outputs": [{"file": o["file"], "bytes": o["bytes"], "label": o["label"], "unicode_range": o["unicode_range"]} for o in f["outputs"]],
                         "axes_trimmed": f.get("axis_limits"), "features_dropped": f.get("features_dropped"), "rfn": f.get("rfn")}
                        for f in manifest["files"]]
    if diff:
        out["pixel_diff"] = diff["summary"]
    return out


def to_markdown(r: dict) -> str:
    L = ["# Font bytes saved", "", "| Page | Before | After | Saved | Files |", "|---|---:|---:|---:|---|"]
    for p in r["pages"]:
        L.append(f"| `{p['page']}` | {p['before_bytes']:,} B | {p['after_bytes']:,} B | {p['saved_pct']}% | {p['files_before']} → {p['files_after']} |")
    L.append(f"| **all pages** | **{r['total_before_bytes']:,} B** | **{r['total_after_bytes']:,} B** | **{r['total_saved_pct']}%** | |")
    if r.get("files"):
        L += ["", "| Font file | Before | After (pieces) | Axes | Dropped features |", "|---|---:|---|---|---|"]
        for f in r["files"]:
            pieces = ", ".join(f"{o['label']} {o['bytes']:,} B" for o in f["outputs"])
            axes = ", ".join(f"{k} {v[0]:g}–{v[1]:g}" for k, v in (f["axes_trimmed"] or {}).items()) or "static"
            L.append(f"| `{Path(f['source']).name}` | {f['bytes_before']:,} B | {pieces} | {axes} | {', '.join(f['features_dropped'] or []) or '-'} |")
    if r.get("pixel_diff"):
        s = r["pixel_diff"]
        L += ["", f"Pixel diff: {s['pages']} screenshots, {s['pass']} identical, {s['tolerated']} tolerated, {s['fail']} failed; "
                  f"{s['total_differing_pixels']} differing pixels in total; max CLS after = {s['max_cls_after']}."]
    return "\n".join(L) + "\n"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--before", required=True)
    ap.add_argument("--after", required=True)
    ap.add_argument("--manifest")
    ap.add_argument("--diff")
    ap.add_argument("--out", required=True, help="path without extension; writes <out>.md and <out>.json")
    a = ap.parse_args(argv)
    r = build(read_json(a.before), read_json(a.after), read_json(a.manifest) if a.manifest else None, read_json(a.diff) if a.diff else None)
    write_json(a.out + ".json", r)
    Path(a.out + ".md").write_text(to_markdown(r))
    print(to_markdown(r))
    return r


if __name__ == "__main__":
    main()
