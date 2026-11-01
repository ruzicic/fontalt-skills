# SIL OFL and the Reserved Font Name (RFN)

Many open fonts are under the SIL Open Font License 1.1. Some of them declare a **Reserved Font Name** in the
copyright notice, e.g. `Copyright 2014-2021 Adobe ... with Reserved Font Name 'Source'`.

OFL 1.1 section 3: *"No Modified Version of the Font Software may use the Reserved Font Name(s) unless explicit
written permission is granted by the corresponding Copyright Holder."* Subsetting, instancing or removing hinting
makes a Modified Version. So a subset of such a font must not carry the reserved name in its internal name table.

(Not legal advice. Fonts under licences that forbid modification at all cannot be subset: stop and tell the user.)

## What `optimize_fonts.py` does
- Detects RFNs from name IDs 0 (copyright), 10 (description) and 13 (licence) with the pattern
  `Reserved Font Name(s) 'X'` (also curly quotes, `“X”`, and several names). Add more with `--rfn NAME`.
- Renames the RFN inside the name records that identify the font - IDs 1, 2, 3, 4, 6, 16, 17, 21, 22, 25 and every
  ID >= 256 (variable-font instance names) - replacing the reserved word by `--rfn-alias` (default `Slim`), so
  `Source Serif 4` becomes `Slim Serif 4`, PostScript names are rewritten the same way.
- Keeps IDs 0 and 7-14 (copyright, trademark, manufacturer, designer, description, URLs, licence) **verbatim**:
  the licence text and credit must stay with the file.
- Verifies afterwards that no name record outside 0 and 7-14 still contains the RFN (case-insensitive) and aborts
  otherwise.
- Does **not** touch the `@font-face` `font-family` in CSS: that is a CSS alias, not the font's internal name, so
  the site's stacks and fallback faces keep working.

## Check by hand
```bash
python3 - <<'PY'
from fontTools.ttLib import TTFont
f = TTFont("public/fonts/optimized/some-core.woff2")
for r in f["name"].names:
    print(r.nameID, r.toUnicode()[:90])
PY
```
Fonts without an RFN (for example Atkinson Hyperlegible, Geist, JetBrains Mono) are not renamed.
Ship the font's licence next to the files (`LICENSE-<font>.txt`) as the OFL requires.
