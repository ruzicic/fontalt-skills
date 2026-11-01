#!/usr/bin/env python3
"""Step 2 - find what the site actually uses (rendered pages, inline component styles included).

For every page x viewport x colour scheme it records, per text-bearing element: font-family stack,
weight, style, stretch, size, font-variation-settings, font-feature-settings and font-variant-*,
the characters drawn (after text-transform / small-caps / hyphens:auto -> U+2010 / ::before / ::after /
placeholders / list markers / q quotes / text-overflow ellipsis). It also replays every style rule that sets
weight / variation / feature / variant properties (so :hover, :focus and media-query overrides count too).

Characters are then assigned to the @font-face file the browser would pick (CSS font matching incl.
unicode-range and cmap coverage); characters that fall through to a system font are never assigned,
so CJK drawn by the OS font stays out of your web fonts.

  python3 scan_usage.py --dir dist --paths / /blog/ --save-fonts work/src-fonts --out work/usage.json
  python3 scan_usage.py --base-url http://localhost:4321 --paths / /about/ --extra-text content/*.md
"""
from __future__ import annotations

import argparse
import re
import sys
from collections import defaultdict
from pathlib import Path
from urllib.parse import unquote, urljoin, urlparse

sys.path.insert(0, str(Path(__file__).parent))
from common import (in_ranges, launch_browser, new_context, page_url, parse_unicode_range,  # noqa: E402
                    serve_dir, settle, write_json)
from fontTools.ttLib import TTFont  # noqa: E402

COLLECT_JS = r"""
() => {
  const SKIP = new Set(['SCRIPT','STYLE','NOSCRIPT','TEMPLATE','HEAD','TITLE','META','LINK','BASE']);
  const faces = [], blockedSheets = [];
  let order = 0;
  const visitRules = (rules, sheetHref, rulesOut) => {
    for (const r of rules) {
      if (r.type === CSSRule.FONT_FACE_RULE) {
        const s = r.style;
        faces.push({
          order: order++, family: s.getPropertyValue('font-family').replace(/^["']|["']$/g, '').trim(),
          weight: s.getPropertyValue('font-weight') || 'normal', style: s.getPropertyValue('font-style') || 'normal',
          stretch: s.getPropertyValue('font-stretch') || 'normal',
          unicodeRange: s.getPropertyValue('unicode-range') || '',
          src: s.getPropertyValue('src'), display: s.getPropertyValue('font-display'),
          descriptors: Object.fromEntries(['font-feature-settings','font-variation-settings','size-adjust','ascent-override','descent-override','line-gap-override']
            .map(k => [k, s.getPropertyValue(k)]).filter(([k,v]) => v)),
          base: sheetHref || document.baseURI,
        });
      } else if (r.type === CSSRule.STYLE_RULE) {
        rulesOut.push(r);
      } else if (r.cssRules) {
        visitRules(r.cssRules, sheetHref, rulesOut);
      }
    }
  };
  const styleRules = [];
  for (const sh of document.styleSheets) {
    try { visitRules(sh.cssRules, sh.href, styleRules); } catch (e) { blockedSheets.push(sh.href); }
  }
  const records = new Map();
  const VARS = ['font-variant-ligatures','font-variant-caps','font-variant-numeric','font-variant-east-asian','font-variant-alternates','font-variant-position'];
  const splitFamilies = (s) => { const out = []; let cur = '', q = null;
    for (const ch of s) { if (q) { if (ch === q) q = null; else cur += ch; } else if (ch === '"' || ch === "'") q = ch; else if (ch === ',') { out.push(cur.trim()); cur = ''; } else cur += ch; }
    if (cur.trim()) out.push(cur.trim()); return out; };
  const transform = (text, cs) => {
    let t = text;
    const tt = cs.textTransform;
    if (tt.includes('uppercase')) t = t.toUpperCase() + t;
    else if (tt.includes('lowercase')) t = t.toLowerCase() + t;
    else if (tt.includes('capitalize')) t = t + t.toUpperCase() + t.toLowerCase();
    const caps = cs.fontVariantCaps;
    if (caps && caps !== 'normal') t = t + t.toUpperCase() + t.toLowerCase();
    if (cs.hyphens === 'auto') t += '\u2010';
    if (cs.textOverflow === 'ellipsis') t += '\u2026';
    return t;
  };
  const add = (el, cs, text, over) => {
    if (!text) return;
    const o = over || {};
    const rec = {
      families: splitFamilies(cs.fontFamily), weight: o.weight || cs.fontWeight, style: cs.fontStyle, stretch: cs.fontStretch,
      size: parseFloat(cs.fontSize), opticalSizing: cs.fontOpticalSizing,
      fvs: o.fvs || cs.fontVariationSettings, ffs: o.ffs || cs.fontFeatureSettings,
      variant: Object.fromEntries(VARS.map(v => [v, (o.variant && o.variant[v]) || cs.getPropertyValue(v)]).filter(([k, v]) => v && v !== 'normal')),
      kerning: cs.fontKerning, writingMode: cs.writingMode,
    };
    const key = JSON.stringify(rec);
    let e = records.get(key);
    if (!e) { e = { rec, chars: new Set() }; records.set(key, e); }
    for (const ch of transform(text, cs)) e.chars.add(ch);
  };
  const pseudoText = (el, which) => {
    const cs = getComputedStyle(el, which);
    const c = cs.content;
    if (!c || c === 'none' || c === 'normal') return null;
    let out = '';
    for (const m of c.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) out += (m[1] ?? m[2]).replace(/\\([0-9a-f]{1,6}) ?/gi, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/\\(.)/g, '$1');
    const at = c.match(/attr\(([^)]+)\)/); if (at) out += el.getAttribute(at[1].trim()) || '';
    if (/counter/.test(c)) out += '0123456789.';
    return out ? { cs, text: out } : null;
  };
  const walker = document.createTreeWalker(document.body || document.documentElement, NodeFilter.SHOW_ELEMENT);
  let el = walker.currentNode;
  const elements = [];
  while (el) { elements.push(el); el = walker.nextNode(); }
  for (const el of elements) {
    if (SKIP.has(el.tagName)) continue;
    const cs = getComputedStyle(el);
    let own = '';
    for (const n of el.childNodes) if (n.nodeType === 3) own += n.nodeValue;
    if (own.trim()) add(el, cs, own);
    if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') { add(el, cs, (el.getAttribute('placeholder') || '') + (el.value || '')); }
    if (el.tagName === 'Q') { for (const m of cs.quotes.matchAll(/"([^"]*)"/g)) add(el, cs, m[1]); }
    if (cs.display === 'list-item') add(el, cs, '0123456789.\u2022');
    for (const w of ['::before', '::after', '::marker', '::first-letter', '::first-line']) {
      if (w === '::before' || w === '::after') { const p = pseudoText(el, w); if (p) add(el, p.cs, p.text); }
    }
  }
  // Replay rules that change font behaviour: a state we cannot render (:hover, :focus, media queries) still counts.
  const PROPS = ['font-weight','font-variation-settings','font-feature-settings','font-stretch','font-style','font-variant-ligatures','font-variant-caps','font-variant-numeric','font-variant-alternates','font-variant-position'];
  for (const r of styleRules) {
    const st = r.style; const decl = {};
    for (const p of PROPS) { const v = st.getPropertyValue(p); if (v) decl[p] = v; }
    if (!Object.keys(decl).length) continue;
    const sel = r.selectorText.split(',').map(s => s.replace(/:(hover|focus|focus-visible|focus-within|active|visited|target|checked|disabled|enabled|placeholder-shown|first-child|last-child|nth-child\([^)]*\))/g, '')
      .replace(/::?(before|after|marker|first-letter|first-line|selection|placeholder)/g, '').trim()).filter(Boolean).join(',');
    let matched = [];
    try { matched = [...document.querySelectorAll(sel)].slice(0, 300); } catch (e) { continue; }
    for (const m of matched) {
      const cs = getComputedStyle(m);
      const text = m.textContent || '';
      if (!text.trim()) continue;
      const over = { variant: {} };
      if (decl['font-weight']) over.weight = ({normal:'400', bold:'700'})[decl['font-weight']] || (/^\d+(\.\d+)?$/.test(decl['font-weight']) ? decl['font-weight'] : undefined);
      if (decl['font-variation-settings']) over.fvs = decl['font-variation-settings'];
      if (decl['font-feature-settings']) over.ffs = decl['font-feature-settings'];
      for (const v of ['font-variant-ligatures','font-variant-caps','font-variant-numeric','font-variant-alternates','font-variant-position']) if (decl[v]) over.variant[v] = decl[v];
      add(m, cs, text, over);
    }
  }
  const preloads = [...document.querySelectorAll('link[rel~=preload][as=font]')].map(l => l.href);
  return { faces, blockedSheets, preloads, records: [...records.values()].map(e => ({ ...e.rec, chars: [...e.chars].join('') })) };
}
"""


# ----- CSS font matching (simplified CSS Fonts 4, section 5.2) -----
def parse_weight(v: str) -> tuple[float, float]:
    v = (v or "normal").strip().lower()
    parts = []
    for tok in v.split():
        parts.append({"normal": 400.0, "bold": 700.0}.get(tok, None) or float(tok))
    return (parts[0], parts[-1]) if parts else (400.0, 400.0)


def parse_stretch(v: str) -> tuple[float, float]:
    v = (v or "normal").strip().lower()
    names = {"ultra-condensed": 50, "extra-condensed": 62.5, "condensed": 75, "semi-condensed": 87.5, "normal": 100,
             "semi-expanded": 112.5, "expanded": 125, "extra-expanded": 150, "ultra-expanded": 200}
    parts = []
    for tok in v.split():
        parts.append(float(tok.rstrip("%")) if tok.rstrip("%").replace(".", "").isdigit() else names.get(tok, 100.0))
    return (parts[0], parts[-1]) if parts else (100.0, 100.0)


def face_style_kind(v: str) -> str:
    v = (v or "normal").strip().lower()
    return "italic" if v.startswith("italic") else "oblique" if v.startswith("oblique") else "normal"


def pick_faces(faces: list[dict], weight: float, style: str, stretch: float) -> list[dict]:
    if not faces:
        return []
    # 1. stretch
    def sdist(f):
        a, b = f["stretch_range"]
        return 0 if a <= stretch <= b else min(abs(a - stretch), abs(b - stretch))
    best = min(sdist(f) for f in faces)
    group = [f for f in faces if sdist(f) == best]
    # 2. style
    pref = {"normal": ["normal", "oblique", "italic"], "italic": ["italic", "oblique", "normal"], "oblique": ["oblique", "italic", "normal"]}[style]
    for k in pref:
        g = [f for f in group if f["style_kind"] == k]
        if g:
            group = g
            break
    # 3. weight
    def contains(f):
        a, b = f["weight_range"]
        return a <= weight <= b
    exact = [f for f in group if contains(f)]
    if exact:
        chosen = exact[0]["weight_range"]
    else:
        cand = sorted({f["weight_range"] for f in group})
        below = sorted([c for c in cand if c[1] < weight], key=lambda c: -c[1])
        above = sorted([c for c in cand if c[0] > weight], key=lambda c: c[0])
        if 400 <= weight <= 500:
            mid = sorted([c for c in cand if weight < c[0] <= 500], key=lambda c: c[0])
            order = mid + below + above
        elif weight < 400:
            order = below + above
        else:
            order = above + below
        chosen = order[0]
    return [f for f in group if f["weight_range"] == chosen]


def parse_fvs(s: str) -> dict[str, float]:
    out = {}
    for m in re.finditer(r'["\']([A-Za-z0-9 ]{4})["\']\s+(-?[0-9.]+)', s or ""):
        out[m.group(1)] = float(m.group(2))
    return out


VARIANT_TAGS = {
    "common-ligatures": ["liga", "clig"], "discretionary-ligatures": ["dlig"], "historical-ligatures": ["hlig"], "contextual": ["calt"],
    "small-caps": ["smcp"], "all-small-caps": ["smcp", "c2sc"], "petite-caps": ["pcap"], "all-petite-caps": ["pcap", "c2pc"],
    "unicase": ["unic"], "titling-caps": ["titl"],
    "lining-nums": ["lnum"], "oldstyle-nums": ["onum"], "proportional-nums": ["pnum"], "tabular-nums": ["tnum"],
    "diagonal-fractions": ["frac"], "stacked-fractions": ["afrc"], "ordinal": ["ordn"], "slashed-zero": ["zero"],
    "jis78": ["jp78"], "jis83": ["jp83"], "jis90": ["jp90"], "jis04": ["jp04"], "simplified": ["smpl"], "traditional": ["trad"],
    "full-width": ["fwid"], "proportional-width": ["pwid"], "ruby": ["ruby"], "historical-forms": ["hist"],
    "sub": ["subs"], "super": ["sups"],
}


def features_from_record(rec: dict) -> set[str]:
    tags: set[str] = set()
    for m in re.finditer(r'["\']([A-Za-z0-9 ]{4})["\']\s*(on|off|[0-9]+)?', rec.get("ffs") or ""):
        val = (m.group(2) or "on").lower()
        if val not in ("off", "0"):
            tags.add(m.group(1))
    for v in rec.get("variant", {}).values():
        for tok in re.findall(r"[a-z0-9-]+(?:\([^)]*\))?", v):
            base = tok.split("(")[0]
            arg = re.search(r"\((\d+)", tok)
            if base in VARIANT_TAGS:
                tags.update(VARIANT_TAGS[base])
            elif base == "styleset" and arg:
                tags.add(f"ss{int(arg.group(1)):02d}")
            elif base == "character-variant" and arg:
                tags.add(f"cv{int(arg.group(1)):02d}")
            elif base == "stylistic":
                tags.add("salt")
            elif base == "swash":
                tags.add("swsh")
            elif base == "ornaments":
                tags.add("ornm")
            elif base == "annotation":
                tags.add("nalt")
    if rec.get("writingMode", "horizontal-tb") != "horizontal-tb":
        tags.update({"vert", "vrt2", "vkrn", "vpal", "valt", "vhal"})
    return tags


def resolve_face_urls(face: dict) -> list[dict]:
    out = []
    for m in re.finditer(r'url\(\s*(?:"([^"]*)"|\'([^\']*)\'|([^)]*?))\s*\)(?:\s*format\(\s*["\']?([^"\')]+)["\']?\s*\))?', face["src"]):
        u = m.group(1) or m.group(2) or m.group(3)
        out.append({"url": urljoin(face["base"], u), "format": (m.group(4) or "").lower()})
    return out


def scan(base: str, paths: list[str], widths, schemes, save_dir: Path | None) -> dict:
    from playwright.sync_api import sync_playwright
    collected = []  # (path, width, scheme, data)
    font_bytes: dict[str, bytes] = {}
    with sync_playwright() as p:
        browser = launch_browser(p)
        for scheme in schemes:
            for width in widths:
                for path in paths:
                    ctx = new_context(browser, width, scheme)
                    page = ctx.new_page()

                    def on_response(resp):
                        try:
                            if resp.request.resource_type == "font":
                                font_bytes[resp.url] = resp.body()
                        except Exception:
                            pass

                    page.on("response", on_response)
                    page.goto(page_url(base, path), wait_until="load")
                    settle(page)
                    collected.append((path, width, scheme, page.evaluate(COLLECT_JS)))
                    ctx.close()
        browser.close()
    return {"collected": collected, "font_bytes": font_bytes}


def build_usage(base: str, raw: dict, save_dir: Path | None, extra_chars: str, notes: list[str]) -> dict:
    # unique faces (same rule seen on many pages)
    faces_by_key: dict[tuple, dict] = {}
    for path, width, scheme, data in raw["collected"]:
        for b in data["blockedSheets"]:
            notes.append(f"cross-origin stylesheet not readable (its fonts cannot be optimised): {b}")
        for f in data["faces"]:
            key = (f["family"], f["weight"], f["style"], f["stretch"], f["unicodeRange"], f["src"], f["base"])
            faces_by_key.setdefault(key, f)
    faces = []
    for f in sorted(faces_by_key.values(), key=lambda f: f["order"]):
        srcs = resolve_face_urls(f)
        pick = next((s for s in srcs if s["format"] in ("woff2", "") or s["url"].endswith(".woff2")), srcs[0] if srcs else None)
        if not pick:
            continue
        f = dict(f)
        f["url"] = pick["url"]
        f["weight_range"] = parse_weight(f["weight"])
        f["stretch_range"] = parse_stretch(f["stretch"])
        f["style_kind"] = face_style_kind(f["style"])
        f["ranges"] = parse_unicode_range(f["unicodeRange"])
        f["family_key"] = f["family"].strip("\"' ").lower()
        faces.append(f)

    # load every font file once (bytes captured from the network log; fall back to HTTP fetch)
    files: dict[str, dict] = {}
    for f in faces:
        if f["url"] in files:
            continue
        data = raw["font_bytes"].get(f["url"])
        if data is None:
            continue  # never requested on any page: not exercised
        font = TTFont(__import__("io").BytesIO(data))
        cmap = set((font.getBestCmap() or {}).keys())
        axes = {a.axisTag: (a.minValue, a.defaultValue, a.maxValue) for a in font["fvar"].axes} if "fvar" in font else {}
        files[f["url"]] = {"url": f["url"], "path": urlparse(f["url"]).path, "bytes": len(data), "cmap": cmap, "axes": axes,
                           "chars": set(), "axis_values": defaultdict(set), "features": set(), "pages": defaultdict(set),
                           "weights_requested": set(), "data": data}
    unexercised = [f["url"] for f in faces if f["url"] not in files]

    sysfont_chars: dict[str, set] = defaultdict(set)
    by_family: dict[str, list[dict]] = defaultdict(list)
    for f in faces:
        by_family[f["family_key"]].append(f)

    for path, width, scheme, data in raw["collected"]:
        for rec in data["records"]:
            weight = float(rec["weight"]) if re.match(r"^[0-9.]+$", str(rec["weight"])) else {"normal": 400.0, "bold": 700.0}.get(rec["weight"], 400.0)
            style = face_style_kind(rec["style"])
            stretch = parse_stretch(rec["stretch"])[0]
            fvs = parse_fvs(rec["fvs"])
            feats = features_from_record(rec)
            chars = set(rec["chars"]) | {" "}
            for ch in chars:
                cp = ord(ch)
                if cp < 0x20 and ch not in "\t\n":
                    continue
                for fam in rec["families"]:
                    group_faces = by_family.get(fam.strip("\"' ").lower())
                    if not group_faces:
                        if fam.lower() not in ("serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "ui-sans-serif", "ui-serif", "ui-monospace", "ui-rounded", "emoji", "math", "fangsong", "inherit"):
                            sysfont_chars[fam].add(ch)  # a named system font (or a font we could not read)
                        break  # system font draws it
                    chosen = pick_faces(group_faces, weight, style, stretch)
                    face = next((c for c in reversed(chosen) if in_ranges(cp, c["ranges"])), None)
                    if face is None:
                        continue  # unicode-range excludes it -> next family
                    info = files.get(face["url"])
                    if info is None:
                        break  # face exists but was never fetched (should not happen for drawn text)
                    if cp not in info["cmap"]:
                        continue  # face lacks the glyph -> falls to next family
                    info["chars"].add(cp)
                    info["pages"][path].add(cp)
                    info["features"] |= feats
                    # axis values this drawing needs
                    wlo, whi = face["weight_range"]
                    wused = min(max(weight, wlo), whi)
                    slo, shi = face["stretch_range"]
                    vals = {"wght": wused, "wdth": min(max(stretch, slo), shi)}
                    if rec.get("opticalSizing", "auto") != "none":
                        vals["opsz"] = rec["size"]
                    vals.update(fvs)
                    for tag, (amin, _d, amax) in info["axes"].items():
                        if tag in vals:
                            info["axis_values"][tag].add(min(max(vals[tag], amin), amax))
                        else:
                            info["axis_values"][tag].add(None)  # axis not understood: keep full range
                    break
    for ch in extra_chars:
        # extra text we could not render: attribute to any file covering it (family-agnostic, conservative)
        for info in files.values():
            if ord(ch) in info["cmap"]:
                info["chars"].add(ord(ch))

    out_files = []
    for url, info in files.items():
        local = None
        if save_dir:
            save_dir.mkdir(parents=True, exist_ok=True)
            local = save_dir / Path(info["path"]).name
            local.write_bytes(info["data"])
        rules = [f for f in faces if f["url"] == url]
        axis_ranges = {}
        for tag, vals in info["axis_values"].items():
            if None in vals or not vals:
                axis_ranges[tag] = None
            else:
                axis_ranges[tag] = [min(vals), max(vals)]
        out_files.append({
            "url": url, "path": info["path"], "local_file": str(local) if local else None, "bytes": info["bytes"],
            "family": rules[0]["family"], "chars": sorted(info["chars"]),
            "axes_in_file": {t: list(v) for t, v in info["axes"].items()},
            "axis_ranges_used": axis_ranges, "features_used": sorted(info["features"]),
            "pages": {pg: sorted(cps) for pg, cps in info["pages"].items()},
            "rules": [{k: r[k] for k in ("family", "weight", "style", "stretch", "unicodeRange", "display", "descriptors")} for r in rules],
        })
    preloads = defaultdict(list)
    for path, width, scheme, data in raw["collected"]:
        for u in data["preloads"]:
            if path not in preloads or u not in preloads[path]:
                preloads[path].append(u)
    return {
        "base_url": base, "files": sorted(out_files, key=lambda f: f["path"]),
        "unexercised_font_files": sorted(set(unexercised)),
        "system_font_chars": {k: "".join(sorted(v)) for k, v in sysfont_chars.items()},
        "preloads": dict(preloads), "notes": sorted(set(notes)),
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--base-url")
    ap.add_argument("--dir", help="built static directory (served on a temporary localhost port)")
    ap.add_argument("--paths", nargs="*", default=["/"])
    ap.add_argument("--widths", nargs="*", type=int, default=[390, 1440])
    ap.add_argument("--schemes", nargs="*", default=["light", "dark"])
    ap.add_argument("--extra-text", nargs="*", default=[], help="text/markdown/json files whose characters may appear later (CMS, i18n)")
    ap.add_argument("--save-fonts", help="directory to save the font files the pages downloaded (inputs for optimize_fonts.py)")
    ap.add_argument("--out", default="usage.json")
    a = ap.parse_args(argv)
    if not (a.base_url or a.dir):
        ap.error("give --base-url or --dir")
    extra = "".join(Path(f).read_text(encoding="utf-8", errors="ignore") for f in a.extra_text)
    notes: list[str] = []
    save = Path(a.save_fonts) if a.save_fonts else None
    if a.dir:
        with serve_dir(a.dir) as base:
            raw = scan(base, a.paths, a.widths, a.schemes, save)
            usage = build_usage(base, raw, save, extra, notes)
    else:
        raw = scan(a.base_url, a.paths, a.widths, a.schemes, save)
        usage = build_usage(a.base_url, raw, save, extra, notes)
    usage["paths"] = a.paths
    write_json(a.out, usage)
    for f in usage["files"]:
        ax = {k: v for k, v in f["axis_ranges_used"].items()}
        print(f"{f['path']}: {len(f['chars'])} chars used, axes used {ax}, features {f['features_used'] or '-'}, {len(f['pages'])} page(s)")
    for u in usage["unexercised_font_files"]:
        print(f"declared but never downloaded (left untouched): {u}")
    for fam, ch in usage["system_font_chars"].items():
        print(f"drawn by system font '{fam}': {len(ch)} chars (left to the OS)")
    for n in usage["notes"]:
        print("note:", n)


if __name__ == "__main__":
    main()
