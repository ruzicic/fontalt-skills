#!/usr/bin/env python3
"""Step 3 - cut each font down to what the site uses (run by hand, commit the output).

For every font file in usage.json (from scan_usage.py):
  1. Reserved Font Name (OFL): detect it in the name table; if present, rename the subset internally.
  2. Trim variable axes (--axes exact|trim|keep; exact only makes edits that cannot move a pixel: it drops the side of an axis
     no used value reaches and pins an axis only when the single value in use is the default).
  3. Subset to: characters used + Latin-1 + Latin Extended-A + ASCII/common punctuation.
  4. Drop OpenType features that are neither default-on nor used, and drop hinting.
  5. Split into a small CORE file (ASCII + curly quotes, dashes, ellipsis, nbsp) and an EXTENDED file
     that sits behind unicode-range (only downloaded when a page draws one of its characters).
  6. Write @font-face rules whose unicode-range lists only characters the file really contains.
Then verify the output and write manifest.json + fonts.generated.css (+ preload.html if preloading is wanted).

Loading behaviour is preserved: font-display, size-adjust, ascent/descent overrides and fallback fonts are copied
from the original @font-face rule untouched. Nothing is preloaded unless --preload on (or auto, and the site already
preloaded that file).

  python3 optimize_fonts.py --usage work/usage.json --out work/fonts-out --url-prefix /fonts/optimized/
"""
from __future__ import annotations

import argparse
import copy
import io
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from common import (CORE_BASE, LATIN1, LATIN_EXT_A, in_ranges, parse_unicode_range, read_json,  # noqa: E402
                    unicode_range_css, write_json)
from fontinfo import DEFAULT_ON_FEATURES, feature_tags, font_facts, has_hinting, reserved_font_names  # noqa: E402
from fontTools import subset  # noqa: E402
from fontTools.ttLib import TTFont  # noqa: E402
from fontTools.varLib import instancer  # noqa: E402

RENAME_IDS = {1, 2, 3, 4, 6, 16, 17, 21, 22, 25}
KEEP_VERBATIM_IDS = {0, 7, 8, 9, 10, 11, 12, 13, 14}  # copyright / licence text legitimately names the RFN


def rename_rfn(font: TTFont, rfns: list[str], alias: str) -> int:
    """Replace every Reserved Font Name in family/style/unique/full/PostScript names. Returns records changed."""
    changed = 0
    pats = []
    for r in rfns:
        pats.append((re.compile(re.escape(r)), alias))
        if " " in r:
            pats.append((re.compile(re.escape(r.replace(" ", ""))), alias.replace(" ", "")))
    for rec in font["name"].names:
        if rec.nameID in KEEP_VERBATIM_IDS:
            continue
        if rec.nameID not in RENAME_IDS and rec.nameID < 256:
            continue
        try:
            text = rec.toUnicode()
        except Exception:
            continue
        new = text
        for pat, rep in pats:
            new = pat.sub(rep, new)
        if new != text:
            rec.string = new
            changed += 1
    return changed


def rfn_leaks(font: TTFont, rfns: list[str]) -> list[str]:
    leaks = []
    for rec in font["name"].names:
        if rec.nameID in KEEP_VERBATIM_IDS:
            continue
        try:
            text = rec.toUnicode()
        except Exception:
            continue
        for r in rfns:
            if r.lower() in text.lower() or r.replace(" ", "").lower() in text.lower():
                leaks.append(f"name ID {rec.nameID}: {text}")
    return leaks


def axis_plan(font: TTFont, used: dict, mode: str = "exact") -> tuple[dict, list[str]]:
    """Return ({tag: (lo, hi)} limits (lo == hi pins), notes) for variable axes.

    mode "keep":  leave every axis alone.
    mode "exact": only edits that cannot move a pixel. The part of an axis on the far side of the default value from
                  every used value is dropped (the used side keeps its masters and deltas untouched), and an axis is
                  pinned only when the single value in use is the default. Used ranges that end strictly inside an
                  axis would need the deltas re-scaled and rounded, which shifts glyph outlines and advance widths by
                  fractions of a font unit: sub-pixel, but visible to a pixel diff. That is "trim".
    mode "trim":  limit every axis to the used range (smallest files; run the pixel diff and decide).
    """
    limits, notes = {}, []
    if "fvar" not in font or mode == "keep":
        return limits, notes
    for a in font["fvar"].axes:
        rng = used.get(a.axisTag)
        if not rng:
            continue  # unknown/undetermined: keep the full axis
        lo, hi = max(rng[0], a.minValue), min(rng[1], a.maxValue)
        if lo > hi:
            continue
        d = a.defaultValue
        if mode == "trim":
            if lo > a.minValue or hi < a.maxValue:
                limits[a.axisTag] = (lo, hi)
            continue
        new_lo = d if lo >= d else a.minValue
        new_hi = d if hi <= d else a.maxValue
        if (new_lo, new_hi) != (a.minValue, a.maxValue):
            limits[a.axisTag] = (new_lo, new_hi)
        if lo > new_lo or hi < new_hi:
            notes.append(f"{a.axisTag}: used {lo:g}-{hi:g} inside {new_lo:g}-{new_hi:g}; --axes trim would cut further (re-scales deltas, may shift glyphs sub-pixel)")
    return limits, notes


def run_instancer(font: TTFont, limits: dict) -> None:
    if not limits:
        return
    spec = {}
    for tag, (lo, hi) in limits.items():
        spec[tag] = lo if lo == hi else (lo, hi)
    instancer.instantiateVariableFont(font, spec, inplace=True, optimize=True)


def subset_font(font: TTFont, codepoints: set[int], features: set[str]) -> TTFont:
    opts = subset.Options()
    opts.layout_features = sorted(features)
    opts.layout_scripts = ["*"]
    opts.hinting = False
    opts.desubroutinize = True
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    opts.glyph_names = False
    opts.legacy_kern = False
    opts.recalc_timestamp = False
    opts.ignore_missing_unicodes = True
    opts.drop_tables = list(opts.drop_tables) + ["STAT", "cvar", "gasp", "hdmx", "VDMX", "LTSH"]
    opts.flavor = "woff2"
    sub = subset.Subsetter(opts)
    sub.populate(unicodes=sorted(codepoints))
    sub.subset(font)
    return font


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")


def output_stem(src: dict) -> str:
    stem = Path(src["path"]).stem
    stem = re.sub(r"\.(p|s)$", "", stem)
    if re.fullmatch(r"[0-9a-f]{8,}(-s)?", stem) or "__" in stem or re.fullmatch(r"[0-9a-f]{8,}.*", stem):
        r = src["rules"][0]
        return slug(f"{r['family']}-{r['style']}-{r['weight']}-{stem[:6]}")
    return slug(stem)


def serialize(font: TTFont) -> bytes:
    buf = io.BytesIO()
    font.flavor = "woff2"
    font.save(buf)
    return buf.getvalue()


def fmt_num(x: float) -> str:
    return f"{x:g}"


def share_axis_ranges(files: list[dict]) -> None:
    """Files that are subsets of one face (same family/style/stretch, e.g. latin + latin-ext) must keep the same axis ranges:
    the browser chooses the face by weight alone, so a character that is only seen at weight 400 in the extended file may
    still be bold elsewhere. Use the union of the observed ranges per family/style/stretch group."""
    groups: dict[tuple, list[dict]] = {}
    for f in files:
        if f.get("rules"):
            r = f["rules"][0]
            groups.setdefault((r["family"], r["style"], r["stretch"]), []).append(f)
    for members in groups.values():
        tags = {t for m in members for t in m["axis_ranges_used"]}
        for t in tags:
            ranges = [m["axis_ranges_used"].get(t) for m in members if t in m["axes_in_file"] or t in m["axis_ranges_used"]]
            if any(r is None for r in ranges):
                merged = None
            else:
                merged = [min(r[0] for r in ranges), max(r[1] for r in ranges)]
            for m in members:
                if t in m["axes_in_file"]:
                    m["axis_ranges_used"][t] = merged


def optimise_one(src: dict, args, out_dir: Path, report_notes: list[str]) -> dict | None:
    local = Path(src["local_file"]) if src.get("local_file") else None
    if not local or not local.exists():
        report_notes.append(f"{src['path']}: source file not saved (run scan_usage.py --save-fonts); skipped")
        return None
    if not src["chars"]:
        report_notes.append(f"{src['path']}: no characters drawn from it on the scanned pages; left untouched")
        return None
    original = TTFont(str(local), recalcTimestamp=False)
    before = font_facts(local)
    rfns = sorted({*reserved_font_names(original), *args.rfn}, key=str.lower)
    rule_ranges = []
    for r in src["rules"]:
        rule_ranges += parse_unicode_range(r["unicodeRange"])
    cmap = set(original.getBestCmap().keys())
    used = set(src["chars"])
    keep = ((used | LATIN1 | LATIN_EXT_A | CORE_BASE) & cmap)
    keep = {cp for cp in keep if in_ranges(cp, rule_ranges)}
    core_set = set(CORE_BASE)
    if 0x2010 in used:
        core_set.add(0x2010)
    if args.core_extra == "used":
        # Every character the scanned pages draw joins the core. The browser shapes each font-face run on its own, so a
        # kerning pair (or the sub-pixel position of the text after it) between an ASCII letter and a neighbour that lives
        # in another file changes pixels. The extended file then holds only the unused Latin-1 / Latin Ext-A headroom
        # and the like: it is fetched when new content needs it (and the script should be rerun by then).
        core_set |= used
    elif args.core_extra == "used-latin":
        core_set |= {cp for cp in used if 0x80 <= cp <= 0x24F}
    # features
    orig_feats = {t for v in feature_tags(original).values() for t in v}
    want_feats = set(DEFAULT_ON_FEATURES) | set(src["features_used"])
    if {"frac", "afrc"} & set(src["features_used"]):
        want_feats |= {"numr", "dnom"}
    # axes
    limits, axis_notes = axis_plan(original, src["axis_ranges_used"], args.axes)
    report_notes += [f"{src['path']}: {n}" for n in axis_notes]

    base = copy.deepcopy(original)
    if rfns:
        n = rename_rfn(base, rfns, args.rfn_alias)
        report_notes.append(f"{src['path']}: Reserved Font Name {rfns} -> renamed {n} name records to '{args.rfn_alias}'")
    run_instancer(base, limits)
    base_bytes = serialize(base)  # a stable intermediate; each piece is cut from a fresh copy

    pieces = []
    if args.no_split:
        pieces.append(("subset", keep))
    else:
        core = keep & core_set
        ext = keep - core
        if core:
            pieces.append(("core", core))
        if ext:
            pieces.append(("ext", ext))
    stem = output_stem(src)
    out_dir.mkdir(parents=True, exist_ok=True)
    outputs = []
    for label, cps in pieces:
        f = TTFont(io.BytesIO(base_bytes), recalcTimestamp=False)
        subset_font(f, cps, want_feats)
        data = serialize(f)
        name = f"{stem}-{label}.woff2" if label != "subset" else f"{stem}.woff2"
        (out_dir / name).write_bytes(data)
        chk = TTFont(io.BytesIO(data), recalcTimestamp=False)
        got = set(chk.getBestCmap().keys())
        problems = []
        if got != (cps & cmap):
            problems.append(f"cmap mismatch: expected {len(cps & cmap)} got {len(got)}")
        if rfns and rfn_leaks(chk, rfns):
            problems.append(f"Reserved Font Name still in name table: {rfn_leaks(chk, rfns)[:2]}")
        if has_hinting(chk) or any(t in chk for t in ("fpgm", "prep", "cvt ")):
            problems.append("hinting not removed")
        if "fvar" in chk:
            for a in chk["fvar"].axes:
                exp = limits.get(a.axisTag)
                if exp and (abs(a.minValue - exp[0]) > 1e-3 or abs(a.maxValue - exp[1]) > 1e-3):
                    problems.append(f"axis {a.axisTag} is {a.minValue}-{a.maxValue}, expected {exp}")
        elif any(a not in limits or limits[a][0] != limits[a][1] for a in (src["axes_in_file"] or {})):
            problems.append("font lost its variable axes unexpectedly")
        if orig_feats & {"kern"} and "kern" not in {t for v in feature_tags(chk).values() for t in v} and len(got) > 1:
            problems.append("kern feature lost")
        if problems:
            raise SystemExit(f"VERIFY FAILED {name}: " + "; ".join(problems))
        outputs.append({"file": name, "label": label, "bytes": len(data), "codepoints": len(got),
                        "unicode_range": unicode_range_css(got - {0}), "ranges_cps": sorted(got),
                        "facts": {k: font_facts(out_dir / name)[k] for k in ("glyphs", "axes", "features", "hinted", "reserved_font_names")}})

    # CSS rules (one set per original @font-face rule that used this file)
    css = []
    for r in src["rules"]:
        # Descriptors are copied verbatim. Every piece of one family/style must carry the SAME weight/stretch descriptor:
        # Chrome picks a face by those descriptors first and only then looks at unicode-range, so a sibling with a
        # narrower weight range would shadow the others for the weights it covers.
        w = r["weight"]
        s = r["stretch"]
        rranges = parse_unicode_range(r["unicodeRange"])
        for o in outputs:
            cps = {cp for cp in o["ranges_cps"] if in_ranges(cp, rranges) and cp != 0}
            if not cps:
                continue
            lines = [f'  font-family: "{r["family"]}";',
                     f'  src: url("{args.url_prefix}{o["file"]}") format("woff2");',
                     f"  font-weight: {w};", f"  font-style: {r['style']};"]
            if s and s != "normal":
                lines.append(f"  font-stretch: {s};")
            if r["display"]:
                lines.append(f"  font-display: {r['display']};")
            for k, v in (r.get("descriptors") or {}).items():
                lines.append(f"  {k}: {v};")
            lines.append(f"  unicode-range: {unicode_range_css(cps)};")
            css.append("@font-face {\n" + "\n".join(lines) + "\n}")
    after_bytes = sum(o["bytes"] for o in outputs)
    return {
        "source": src["path"], "family": src["family"], "output_stem": stem,
        "before": {k: before[k] for k in ("bytes", "glyphs", "codepoints", "axes", "features", "hinted", "reserved_font_names")},
        "after_total_bytes": after_bytes, "outputs": [{k: v for k, v in o.items() if k != "ranges_cps"} for o in outputs],
        "axis_limits": {k: list(v) for k, v in limits.items()},
        "features_dropped": sorted(orig_feats - want_feats), "features_kept": sorted(orig_feats & want_feats),
        "rfn": rfns, "css": css,
        "saved_bytes_if_all_fetched": before["bytes"] - after_bytes,
        "_core_file": next((o["file"] for o in outputs if o["label"] in ("core", "subset")), None),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--usage", required=True)
    ap.add_argument("--out", required=True, help="directory for the generated .woff2 files")
    ap.add_argument("--url-prefix", default="/fonts/", help="URL prefix written into @font-face src (must end with /)")
    ap.add_argument("--css-out", help="default: <out>/fonts.generated.css")
    ap.add_argument("--preload", choices=["auto", "on", "off"], default="auto",
                    help="auto: preload the core file only where the site already preloaded that font; on: always; off: never")
    ap.add_argument("--axes", choices=["exact", "trim", "keep"], default="exact",
                    help="exact (default): only axis edits that cannot move a pixel; trim: limit axes to the used ranges (smaller, "
                         "can shift glyphs by sub-pixel amounts - pixel-diff before shipping); keep: leave axes alone")
    ap.add_argument("--core-extra", choices=["used", "used-latin", "none"], default="used",
                    help="used (default): every character the scanned pages draw goes into the core file, the extended file "
                         "holds only unused headroom (pixel-identical: no kerning pair is split across files); "
                         "used-latin: only accented Latin letters (U+0080-024F) are added to the core; "
                         "none: core is only ASCII + common punctuation (smallest core; text next to a character in "
                         "the extended file can shift by sub-pixel amounts)")
    ap.add_argument("--no-split", action="store_true", help="one subset file per font instead of core + extended")
    ap.add_argument("--rfn", action="append", default=[], help="extra Reserved Font Name to enforce (repeatable)")
    ap.add_argument("--rfn-alias", default="Slim", help="replacement for a Reserved Font Name inside name records")
    a = ap.parse_args(argv)
    if not a.url_prefix.endswith("/"):
        a.url_prefix += "/"
    usage = read_json(a.usage)
    out_dir = Path(a.out)
    notes: list[str] = list(usage.get("notes", []))
    share_axis_ranges(usage["files"])
    results = []
    for src in usage["files"]:
        r = optimise_one(src, a, out_dir, notes)
        if r:
            results.append(r)
    css = "/* Generated by optimize-web-fonts/optimize_fonts.py. Rerun the scripts when content, fonts or CSS font settings change. */\n"
    css += "\n\n".join(c for r in results for c in r["css"]) + "\n"
    css_path = Path(a.css_out) if a.css_out else out_dir / "fonts.generated.css"
    css_path.write_text(css, encoding="utf-8")

    # optional preload
    preloaded_before = {u for urls in usage.get("preloads", {}).values() for u in urls}
    preload_lines, replacements = [], {}
    for r in results:
        core = r["_core_file"]
        old_preloaded = any(u.endswith(r["source"]) for u in preloaded_before)
        if core and (a.preload == "on" or (a.preload == "auto" and old_preloaded)):
            preload_lines.append(f'<link rel="preload" href="{a.url_prefix}{core}" as="font" type="font/woff2" crossorigin>')
            if old_preloaded:
                replacements[r["source"]] = a.url_prefix + core
    if preload_lines:
        (out_dir / "preload.html").write_text("\n".join(preload_lines) + "\n", encoding="utf-8")
    for r in results:
        r.pop("_core_file")

    before = sum(r["before"]["bytes"] for r in results)
    after = sum(r["after_total_bytes"] for r in results)
    manifest = {"files": results, "totals": {"before_bytes": before, "after_bytes_core_plus_extended": after},
                "axes_mode": a.axes, "preload_mode": a.preload, "preload_replacements": replacements, "notes": sorted(set(notes)),
                "url_prefix": a.url_prefix}
    write_json(out_dir / "manifest.json", manifest)
    for r in results:
        parts = ", ".join(f"{o['file']} {o['bytes']:,} B" for o in r["outputs"])
        pct = 100 * (1 - r["after_total_bytes"] / r["before"]["bytes"])
        print(f"{r['source']}: {r['before']['bytes']:,} B -> {r['after_total_bytes']:,} B ({pct:.1f}% smaller if every piece is fetched)  [{parts}]")
        if r["axis_limits"]:
            print(f"    axes trimmed: {r['axis_limits']}")
        if r["features_dropped"]:
            print(f"    features dropped: {', '.join(r['features_dropped'])}")
    print(f"total {before:,} B -> {after:,} B")
    for n in manifest["notes"]:
        print("note:", n)


if __name__ == "__main__":
    main()
