#!/usr/bin/env python3
"""Fixture-authoring helper: size-adjust / ascent / descent / line-gap overrides so a system fallback
occupies the same space as a web font (used to give the fixtures realistic, metric-matched fallbacks;
the optimizer itself never touches fallbacks).

  python3 tests/fallback_metrics.py <web-font.woff2> <system-font.ttf> [--wght 400]
"""
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib import instancer

FREQ = dict(zip("etaoinshrdlcumwfgypbvkjxqz", [12.7, 9.1, 8.2, 7.5, 7.0, 6.7, 6.3, 6.1, 6.0, 4.3, 4.0, 2.8, 2.8, 2.4, 2.4, 2.2, 2.0, 2.0, 1.9, 1.5, 1.0, 0.8, 0.15, 0.15, 0.1, 0.07]))
FREQ[" "] = 18


def avg_width(font):
    cmap = font.getBestCmap()
    hmtx = font["hmtx"]
    upem = font["head"].unitsPerEm
    tot = sum(FREQ.values())
    return sum(hmtx[cmap[ord(c)]][0] * w for c, w in FREQ.items()) / tot / upem


def main():
    web = TTFont(sys.argv[1])
    wght = float(sys.argv[sys.argv.index("--wght") + 1]) if "--wght" in sys.argv else 400
    if "fvar" in web:
        lim = {a.axisTag: (wght if a.axisTag == "wght" else a.defaultValue) for a in web["fvar"].axes}
        web = instancer.instantiateVariableFont(web, lim)
    sysf = TTFont(sys.argv[2], fontNumber=0)
    sa = avg_width(web) / avg_width(sysf)
    uw, us = web["head"].unitsPerEm, sysf["head"].unitsPerEm
    asc = web["hhea"].ascent / uw / sa
    desc = -web["hhea"].descent / uw / sa
    gap = web["hhea"].lineGap / uw / sa
    print(f"size-adjust: {sa*100:.2f}%; ascent-override: {asc*100:.2f}%; descent-override: {desc*100:.2f}%; line-gap-override: {gap*100:.2f}%;")


main()
