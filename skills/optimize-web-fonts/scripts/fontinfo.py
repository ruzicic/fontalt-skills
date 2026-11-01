"""Facts about a font file: size, glyphs, axes, OpenType features, hinting, licence, Reserved Font Names."""
from __future__ import annotations

import re
from pathlib import Path

from fontTools.ttLib import TTFont

_RFN_RE = re.compile(r"(?<!without )Reserved Font Names?\s*(?:is|are|:)?\s*((?:[\"'“‘`][^\"'”’`]+[\"'”’`][\s,]*(?:and|or|&)?\s*)+)", re.I)
_QUOTED = re.compile(r"[\"'“‘`]([^\"'”’`]+)[\"'”’`]")

# Features HarfBuzz/Chrome apply without any CSS opt-in. Everything else is dropped unless the pages use it.
DEFAULT_ON_FEATURES = {
    "ccmp", "locl", "rlig", "rclt", "calt", "clig", "liga", "kern", "mark", "mkmk", "curs", "dist",
    "abvf", "abvm", "blwf", "blwm", "akhn", "cjct", "half", "haln", "nukt", "pref", "pres", "psts",
    "pstf", "rkrf", "rphf", "vatu", "abvs", "blws", "init", "isol", "medi", "fina", "med2", "fin2",
    "fin3", "ljmo", "vjmo", "tjmo", "rvrn", "ltra", "ltrm", "rtla", "rtlm", "stch", "ccmp", "dnom",
    "numr",  # dnom/numr only act via frac; harmless to keep, tiny
}


def name_records(font: TTFont, name_id: int) -> list[str]:
    out = []
    for r in font["name"].names:
        if r.nameID == name_id:
            try:
                out.append(r.toUnicode())
            except Exception:
                pass
    return out


def best_name(font: TTFont, *ids: int) -> str:
    for i in ids:
        v = name_records(font, i)
        if v:
            return v[0]
    return ""


def reserved_font_names(font: TTFont) -> list[str]:
    """Reserved Font Names declared in copyright (ID 0), licence (ID 13) or description (ID 10)."""
    found: list[str] = []
    for i in (0, 10, 13):
        for text in name_records(font, i):
            for m in _RFN_RE.finditer(text):
                found.extend(q.strip() for q in _QUOTED.findall(m.group(1)))
    seen, out = set(), []
    for f in found:
        if f.lower() not in seen:
            seen.add(f.lower())
            out.append(f)
    return out


def has_hinting(font: TTFont) -> bool:
    if any(t in font for t in ("fpgm", "prep", "cvt ")):
        return True
    if "glyf" in font:
        glyf = font["glyf"]
        for n in font.getGlyphOrder():
            g = glyf[n]
            if g.numberOfContours != 0 and hasattr(g, "program") and g.program is not None and len(g.program.getBytecode()) > 0:
                return True
    if "CFF " in font:  # PostScript hints (stems/blue values) live in the Private dict; subsetter keeps them unless no-hinting
        try:
            top = font["CFF "].cff.topDictIndex[0]
            return bool(getattr(top.Private, "StemSnapH", None) or getattr(top.Private, "BlueValues", None))
        except Exception:
            return False
    return False


def feature_tags(font: TTFont) -> dict[str, list[str]]:
    out = {}
    for tbl in ("GSUB", "GPOS"):
        if tbl in font and font[tbl].table.FeatureList:
            out[tbl] = sorted({fr.FeatureTag for fr in font[tbl].table.FeatureList.FeatureRecord})
    return out


def axes(font: TTFont) -> list[dict]:
    if "fvar" not in font:
        return []
    return [{"tag": a.axisTag, "min": a.minValue, "default": a.defaultValue, "max": a.maxValue} for a in font["fvar"].axes]


def font_facts(path) -> dict:
    p = Path(path)
    font = TTFont(str(p))
    cmap = font.getBestCmap() or {}
    feats = feature_tags(font)
    return {
        "file": p.name,
        "bytes": p.stat().st_size,
        "format": font.flavor or ("otf" if "CFF " in font or "CFF2" in font else "ttf"),
        "family": best_name(font, 16, 1),
        "subfamily": best_name(font, 17, 2),
        "version": best_name(font, 5),
        "glyphs": font["maxp"].numGlyphs,
        "codepoints": len(cmap),
        "axes": axes(font),
        "features": feats,
        "hinted": has_hinting(font),
        "tables": sorted(font.keys()),
        "license": (best_name(font, 14, 13)[:200]),
        "reserved_font_names": reserved_font_names(font),
        "sha256": __import__("hashlib").sha256(p.read_bytes()).hexdigest(),
    }
