#!/usr/bin/env python3
"""End-to-end check of the optimize-web-fonts scripts on one fixture site.

  /workspace/fs-venv/bin/python tests/run_fixture.py plain-html --runs 3

Each run, from scratch in <work>/<fixture>/runN:
  build baseline -> measure -> scan usage -> optimize (twice: output must be byte-identical) -> wire into a copy
  of the source -> rebuild -> measure -> pixel diff (3 paths x 2 widths x light/dark) + CLS with every font
  response delayed -> noise-floor diff (baseline vs baseline) -> criteria.

Pass criteria per run: 0 differing pixels (<= 0.02 % per screenshot tolerated, and reported), CLS <= 0.1 and not
worse than baseline + 0.01, >= 20 % fewer font bytes over all measured pages, optimizer idempotent, noise floor 0,
fixture-specific expectations (fixture.json "expect"). Results go to results/<fixture>.json (+ .md, + artefacts).
"""
from __future__ import annotations

import argparse
import datetime as dt
import filecmp
import hashlib
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import time
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
SCRIPTS = ROOT / "skills" / "optimize-web-fonts" / "scripts"
NODE_BIN = os.environ.get("FONT_SKILLS_NODE_BIN", "/workspace/tools/node-v22.23.4-linux-x64/bin")
ENV = {**os.environ, "PATH": f"{NODE_BIN}:{os.environ['PATH']}", "NEXT_TELEMETRY_DISABLED": "1", "ASTRO_TELEMETRY_DISABLED": "1", "CI": "1"}
IGNORE = shutil.ignore_patterns("node_modules", ".next", "dist", ".astro", "out", "__pycache__")


def sh(cmd, cwd=None, log=None, check=True):
    p = subprocess.run([str(c) for c in cmd], cwd=cwd, env=ENV, capture_output=True, text=True)
    if log:
        with open(log, "a") as f:
            f.write(f"$ {' '.join(map(str, cmd))}\n{p.stdout}{p.stderr}\n")
    if check and p.returncode:
        raise RuntimeError(f"{' '.join(map(str, cmd))} failed ({p.returncode}):\n{p.stdout[-2000:]}\n{p.stderr[-2000:]}")
    return p


def script(name, *args, log=None, check=True):
    return sh([sys.executable, SCRIPTS / name, *args], log=log, check=check)


def tree_hashes(d: Path):
    return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(d.iterdir()) if p.is_file()}


def strip_font_faces(css: str, basenames: set[str]) -> str:
    """Remove @font-face blocks that load one of the replaced files (fallback faces etc. are kept)."""
    def keep(m):
        return not any(b in m.group(0) for b in basenames)
    return re.sub(r"(?:/\*[^*]*\*/\s*)?@font-face\s*\{[^}]*\}\s*", lambda m: m.group(0) if keep(m) else "", css)


def load_hook(fix_dir: Path):
    p = fix_dir / "wire.py"
    if not p.exists():
        return None
    spec = importlib.util.spec_from_file_location("fixture_wire", p)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def build(project: Path, fx: dict, nm_cache: Path | None, log):
    if fx["kind"] == "static":
        return project / fx["dist"]
    if not (project / "node_modules").exists():
        sh(["cp", "-al", nm_cache, project / "node_modules"])
    sh(fx["build"], cwd=project, log=log)
    return project / fx["dist"]


def wire_and_build(after_proj: Path, before_proj: Path, opt: Path, usage: dict, manifest: dict, fx: dict, hook, nm_cache, log) -> Path:
    shutil.copytree(before_proj, after_proj, ignore=IGNORE)
    ctx = {"usage": usage, "manifest": manifest, "fixture": fx, "strip_font_faces": strip_font_faces,
           "before_dist": before_proj / fx["dist"]}
    if hook:
        hook.wire(after_proj, opt, ctx)
    else:  # default static wiring: replace the original @font-face blocks by the generated CSS, copy the fonts
        replaced = {Path(f["url"].split("?")[0]).name for f in usage["files"]}
        gen = (opt / "fonts.generated.css").read_text()
        for rel in fx["css_files"]:
            f = after_proj / rel
            f.write_text(strip_font_faces(f.read_text(), replaced) + "\n" + gen)
        dest = after_proj / fx.get("public_dir", "") / fx["url_prefix"].strip("/")
        dest.mkdir(parents=True, exist_ok=True)
        for p in opt.glob("*.woff2"):
            shutil.copy(p, dest / p.name)
        shutil.rmtree(after_proj / fx.get("public_dir", "") / "fonts" / "original", ignore_errors=True)
    return build(after_proj, fx, nm_cache, log)


def run_once(name: str, idx: int, work: Path, hook) -> dict:
    fix = ROOT / "fixtures" / name
    fx = json.loads((fix / "fixture.json").read_text())
    wd = work / name / f"run{idx}"
    shutil.rmtree(wd, ignore_errors=True)
    wd.mkdir(parents=True)
    log = wd / "log.txt"
    t0 = time.time()
    paths = fx["paths"]
    widths = ["390", "1440"]
    nm_cache = None
    if fx["kind"] == "npm":
        nm_cache = work / name / "_node_modules"
        if not nm_cache.exists():
            tmp = work / name / "_install"
            shutil.rmtree(tmp, ignore_errors=True)
            shutil.copytree(fix / fx["source"], tmp, ignore=IGNORE)
            sh(fx["install"], cwd=tmp, log=log)
            shutil.move(tmp / "node_modules", nm_cache)
            shutil.rmtree(tmp, ignore_errors=True)

    before_proj = wd / "before"
    shutil.copytree(fix / fx["source"], before_proj, ignore=IGNORE)
    dist_before = build(before_proj, fx, nm_cache, log)

    script("measure_fonts.py", "--dir", dist_before, "--paths", *paths, "--out", wd / "measure-before.json", log=log)
    script("scan_usage.py", "--dir", dist_before, "--paths", *fx.get("scan_paths", paths), "--out", wd / "usage.json", "--save-fonts", wd / "saved-fonts", log=log)
    axes = fx.get("axes", "exact")
    opt, opt2 = wd / "opt", wd / "opt2"
    pre = fx.get("preload", "auto")
    script("optimize_fonts.py", "--usage", wd / "usage.json", "--out", opt, "--url-prefix", fx["url_prefix"], "--preload", pre, "--axes", axes, log=log)
    script("optimize_fonts.py", "--usage", wd / "usage.json", "--out", opt2, "--url-prefix", fx["url_prefix"], "--preload", pre, "--axes", axes, log=log)
    idempotent = tree_hashes(opt) == tree_hashes(opt2)
    usage = json.loads((wd / "usage.json").read_text())
    manifest = json.loads((opt / "manifest.json").read_text())
    dist_after = wire_and_build(wd / "after", before_proj, opt, usage, manifest, fx, hook, nm_cache, log)

    script("measure_fonts.py", "--dir", dist_after, "--paths", *paths, "--out", wd / "measure-after.json", log=log)
    p = script("pixel_diff.py", "--before-dir", dist_before, "--after-dir", dist_after, "--paths", *paths,
               "--widths", *widths, "--schemes", "light", "dark", "--out", wd / "diff", log=log, check=False)
    diff = json.loads((wd / "diff" / "pixel_diff.json").read_text())
    n = script("pixel_diff.py", "--before-dir", dist_before, "--after-dir", dist_before, "--paths", *paths,
               "--widths", *widths, "--schemes", "light", "dark", "--no-cls", "--out", wd / "noise", log=log, check=False)
    noise = json.loads((wd / "noise" / "pixel_diff.json").read_text())["summary"]["total_differing_pixels"]
    script("report.py", "--before", wd / "measure-before.json", "--after", wd / "measure-after.json",
           "--manifest", opt / "manifest.json", "--diff", wd / "diff" / "pixel_diff.json", "--out", wd / "report", log=log)
    rep = json.loads((wd / "report.json").read_text())
    after_m = json.loads((wd / "measure-after.json").read_text())

    experiment = None
    if idx == 1 and axes == "exact" and fx.get("axis_trim_experiment", True):
        # Not part of the pass criteria: what would limiting axes to the used ranges save, and what would it cost in pixels?
        opt_t = wd / "opt-trim"
        script("optimize_fonts.py", "--usage", wd / "usage.json", "--out", opt_t, "--url-prefix", fx["url_prefix"], "--preload", pre, "--axes", "trim", log=log)
        man_t = json.loads((opt_t / "manifest.json").read_text())
        dist_t = wire_and_build(wd / "after-trim", before_proj, opt_t, usage, man_t, fx, hook, nm_cache, log)
        script("measure_fonts.py", "--dir", dist_t, "--paths", *paths, "--out", wd / "measure-trim.json", log=log)
        script("pixel_diff.py", "--before-dir", dist_before, "--after-dir", dist_t, "--paths", *paths, "--widths", *widths,
               "--schemes", "light", "dark", "--no-cls", "--out", wd / "diff-trim", log=log, check=False)
        dt_ = json.loads((wd / "diff-trim" / "pixel_diff.json").read_text())
        mt = json.loads((wd / "measure-trim.json").read_text())
        tb = sum(v["font_bytes"] for v in mt["pages"].values())
        pix = {k: v["differing_pixels"] for k, v in dt_["pages"].items()}
        pct = [v["differing_pct"] for v in dt_["pages"].values() if v.get("differing_pct") is not None]
        experiment = {"font_bytes_after": tb, "saved_pct": round(100 * (rep["total_before_bytes"] - tb) / rep["total_before_bytes"], 1),
                      "extra_saved_bytes_vs_exact": rep["total_after_bytes"] - tb,
                      "differing_pixels": dt_["summary"]["total_differing_pixels"], "worst_page_differing_pct": max(pct, default=0),
                      "pages_failing": dt_["summary"]["fail"], "pixels_per_page": pix}

    checks = {
        "pixels": diff["summary"]["fail"] == 0,
        "cls": (lambda c: bool(c) and all(v["cls_ok"] for v in c))([v for v in diff["pages"].values() if "cls_ok" in v]),
        "bytes_saved_ge_20pct": rep["total_saved_pct"] >= 20,
        "idempotent": idempotent,
        "noise_floor_zero": noise == 0,
        "preload_policy_kept": all(a["preloads_after"] == a["preloads_before"] or fx.get("preload", "auto") == "on" for a in rep["pages"])
        if fx.get("preload", "auto") == "off" else True,
    }
    for rule in fx.get("expect", {}).get("no_font_substring_on", []):  # e.g. {"path": "/post.html", "substr": "-ext"}
        files = [f for k, v in after_m["pages"].items() if v["path"] == rule["path"] for f in v["font_files"]]
        checks[f"no {rule['substr']} files on {rule['path']}"] = not any(rule["substr"] in f for f in files)
    for rule in fx.get("expect", {}).get("font_substring_on", []):
        files = [f for k, v in after_m["pages"].items() if v["path"] == rule["path"] for f in v["font_files"]]
        checks[f"{rule['substr']} files fetched on {rule['path']}"] = any(rule["substr"] in f for f in files)
    for rule in fx.get("expect", {}).get("max_font_files", []):  # for builds that hash file names
        files = {f for k, v in after_m["pages"].items() if v["path"] == rule["path"] for f in v["font_files"]}
        checks[f"<= {rule['max']} font files on {rule['path']}"] = len(files) <= rule["max"]
    for rule in fx.get("expect", {}).get("min_font_files", []):  # hashed names: unscanned content must pull in extra (ext) pieces
        files = {f for k, v in after_m["pages"].items() if v["path"] == rule["path"] for f in v["font_files"]}
        checks[f">= {rule['min']} font files on {rule['path']}"] = len(files) >= rule["min"]
    green = all(checks.values())
    cls_vals = [(v.get("cls_before"), v.get("cls_after")) for v in diff["pages"].values() if "cls_after" in v]
    result = {
        "run": idx, "green": green, "checks": checks,
        "seconds": round(time.time() - t0, 1),
        "started": dt.datetime.now(ZoneInfo("Europe/Zurich")).isoformat(timespec="seconds"),
        "font_bytes_before": rep["total_before_bytes"], "font_bytes_after": rep["total_after_bytes"],
        "saved_pct": rep["total_saved_pct"], "per_page": rep["pages"],
        "differing_pixels": diff["summary"]["total_differing_pixels"],
        "screenshots": diff["summary"]["pages"], "pixel_summary": diff["summary"],
        "tolerated": {k: {"differing_pixels": v["differing_pixels"], "differing_pct": v["differing_pct"], "clusters": v.get("cluster_list")}
                      for k, v in diff["pages"].items() if v["status"] == "TOLERATED"},
        "cls_before_max": max((c[0] for c in cls_vals), default=None), "cls_after_max": max((c[1] for c in cls_vals), default=None),
        "noise_floor_differing_pixels": noise,
        "font_files": [{"source": f["source"], "bytes_before": f["before"]["bytes"], "bytes_after_all_pieces": f["after_total_bytes"]} for f in manifest["files"]],
        "axis_trim_experiment": experiment,
        "rfn_renames": [n for n in manifest["notes"] if "Reserved" in n],
        "dir": str(wd),
    }
    print(f"[{name} run{idx}] {'GREEN' if green else 'RED'}  bytes {rep['total_before_bytes']:,} -> {rep['total_after_bytes']:,} ({rep['total_saved_pct']}%)  "
          f"diff px={result['differing_pixels']}  CLS {result['cls_before_max']} -> {result['cls_after_max']}  {result['seconds']}s  failed={[k for k, v in checks.items() if not v]}")
    return result


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("fixture")
    ap.add_argument("--runs", type=int, default=3)
    ap.add_argument("--work", default="/workspace/fs-work")
    ap.add_argument("--no-save", action="store_true", help="do not write results/<fixture>.*")
    a = ap.parse_args()
    work = Path(a.work)
    hook = load_hook(ROOT / "fixtures" / a.fixture)
    runs = [run_once(a.fixture, i, work, hook) for i in range(1, a.runs + 1)]
    ok = all(r["green"] for r in runs)
    print(f"{a.fixture}: {sum(r['green'] for r in runs)}/{len(runs)} runs green")
    if not a.no_save:
        res = ROOT / "results"
        res.mkdir(exist_ok=True)
        last = Path(runs[-1]["dir"])
        art = res / a.fixture
        shutil.rmtree(art, ignore_errors=True)
        art.mkdir()
        for f in ["usage.json", "report.md", "report.json", "measure-before.json", "measure-after.json"]:
            shutil.copy(last / f, art / f)
        shutil.copy(last / "opt" / "manifest.json", art / "manifest.json")
        shutil.copy(last / "opt" / "fonts.generated.css", art / "fonts.generated.css")
        shutil.copy(last / "diff" / "pixel_diff.json", art / "pixel_diff.json")
        if (last / "diff" / "img").exists():
            for p in (last / "diff" / "img").glob("*-diff.png"):
                (art / "diff-images").mkdir(exist_ok=True)
                shutil.copy(p, art / "diff-images" / p.name)
        for r in runs:
            r.pop("dir")
        summary = {"fixture": a.fixture, "runs_green": sum(r["green"] for r in runs), "runs": len(runs), "all_green": ok, "runs_detail": runs}
        (res / f"{a.fixture}.json").write_text(json.dumps(summary, indent=2, ensure_ascii=False) + "\n")
    sys.exit(0 if ok else 1)


if __name__ == "__main__":
    main()
