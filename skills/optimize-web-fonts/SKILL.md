---
name: optimize-web-fonts
description: Shrink a site's web font bytes without changing how anything looks, and prove it with before/after pixel diffs. Use when asked to optimize, subset, slim down or speed up web fonts, reduce font weight or LCP caused by fonts, split fonts with unicode-range, trim variable font axes, or audit what fonts a page really loads. Measures current fonts, finds the characters/axes/features actually used with Playwright, subsets with fontTools (used chars + Latin-1 + Latin Ext-A), splits a core file from an extended unicode-range file, drops unused features and hinting, handles OFL Reserved Font Names, and reports bytes saved. Run by hand; nothing is added to the build.
---

# optimize-web-fonts

Make a site's web fonts smaller and keep rendering **pixel-identical**. You run scripts by hand, commit their output
and say when to rerun them. Nothing is added to the site's build.

Inspired by Shu Ding's prompt: https://x.com/shuding/status/2115855028737200211

## Rules (from the owner's brief; do not relax them silently)

1. Any visual change is a regression unless the user approves it. If an optimization would change rendering,
   say what it saves and what it changes, and leave it off by default (`--axes trim` is exactly that case).
2. Keep the current loading behaviour: do not touch `font-display`, `size-adjust`/override descriptors or fallback fonts.
   The scripts copy those descriptors verbatim.
3. Preloading is optional. Some sites forbid preloads (they can hurt FCP). Default is to preserve the site's policy:
   `--preload auto` preloads the **core** file only where the site already preloaded that font; `off` never; `on` always.
4. No font processing in the site's build. The user runs the scripts by hand and commits the generated files.
5. Never ship a Reserved-Font-Name font under its original name after subsetting (OFL). See `references/ofl-rfn.md`.
6. Before you call it done: pixel diff on pages with code, italics, accented characters, components with their own
   font settings and CJK; explain every differing pixel; re-measure; confirm extended files load only where needed.

## Setup

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r <skill dir>/requirements.txt
playwright install chromium        # skip if a Chromium is already installed
```

Browser caveat: each Playwright release looks for one exact Chromium build (`~/.cache/ms-playwright/chromium_headless_shell-<rev>`).
`requirements.txt` pins `playwright==1.57.0`, which uses revision 1200 (Chromium 143), the build cached on the reference box.
If your cache holds another revision, either pin the Playwright version that matches it (`pip install playwright==<v>`;
the revision is in `playwright/driver/package/browsers.json`) or run `playwright install chromium`. Pixel diffs are only
comparable within one Chromium build, so keep before and after runs on the same one.

All scripts live in `<skill dir>/scripts/`, need only Python 3.10+, and print `--help`. Use paths relative to the
user's project; keep work files in a scratch directory (`work/`) and commit only the generated fonts + CSS.

## Workflow

### 0. Build a baseline you can diff against
Build the site as it is today into a directory (`dist/`, `out/`, `.next` export...) or run it on a URL. Copy that
build to `work/before/` (static) or keep the dev server for the "before" URL. Pick representative `--paths`:
a text-only page, a page with code, one with italics/bold-italic, accented or non-Latin text, pages with
components that set their own `font-*`, a page with CJK. More pages = fewer surprises.

### 1. Measure the current state
```bash
python3 scripts/measure_fonts.py --dir work/before --paths / /blog/ /docs/ --out work/measure-before.json
# or: --base-url http://localhost:4321 ; or just files: --files public/fonts/*.woff2
```
Reports per file: bytes, glyphs, variable axes, OpenType features, hinting, Reserved Font Name; per page: font bytes
actually downloaded, which files, what the page preloads.

### 2. Find what the site really uses
```bash
python3 scripts/scan_usage.py --dir work/before --paths / /blog/ /docs/ \
  --extra-text content/*.md --save-fonts work/src-fonts --out work/usage.json
```
Renders each page at 390 and 1440 px in light and dark, walks every text node, applies `text-transform`, small-caps,
`::before/::after`, list markers, `q` quotes, placeholders, `hyphens: auto` (U+2010 when hyphenation happens) and
assigns every character to the `@font-face` file the browser really picks (unicode-range, cmap, weight, style).
Characters drawn by a **system fallback font (e.g. CJK)** are not assigned to any web font and stay with the OS.
It also records per file the weight/`wdth`/`opsz` values used (computed styles, inline `font-variation-settings`,
`:hover`/`:focus`/media-query overrides) and the OpenType features turned on (`font-feature-settings`,
`font-variant-*`, `font-variant-numeric` etc.). `--extra-text` adds characters from content that is not rendered yet
(CMS, i18n files).
**Check `usage.json`** `notes` and `unexercised_font_files`: a font file the pages never fetched (e.g. latin-ext) is
left untouched; a state the scan cannot reach (a modal, a logged-in view) is invisible to it - add those pages or
`--extra-text`, or keep that font's axes by hand (`--axes keep`).

### 3. Cut the fonts down
```bash
python3 scripts/optimize_fonts.py --usage work/usage.json --out public/fonts/optimized \
  --url-prefix /fonts/optimized/ --preload auto
```
Per font file, in this order:
1. **Reserved Font Name**: detected from name IDs 0/10/13; the subset's name records are renamed (default alias `Slim`,
   `--rfn-alias`, extra names with `--rfn`). Copyright/licence/designer records are kept verbatim.
2. **Axes** (`--axes exact` default): drops only the part of an axis that no used value reaches (e.g. `wght` 100-400
   when the lightest weight used is 400 and the default is 400) and pins an axis only if the single used value is the
   default. Lossless. Variable axes are shared across the sibling files of one face (latin + latin-ext) because the
   browser picks the face by weight first. `--axes trim` limits axes to the used ranges (smaller; fontTools re-scales
   and rounds the deltas, which moved ~2,400-3,000 edge pixels on a text page in testing: report it, do not ship it
   without approval). `--axes keep` leaves axes alone.
3. **Subset**: used characters + Latin-1 + Latin Extended-A + core punctuation, intersected with the font's cmap and
   with the original rule's `unicode-range`.
4. **Features and hinting**: keeps default-on features (`ccmp locl mark mkmk kern liga clig calt rlig...`) plus those
   the scan saw; drops the rest and all hinting (`fpgm prep cvt gasp`...).
5. **Core + extended split**: core = ASCII, nbsp, curly quotes, en/em dash, ellipsis (+U+2010 when `hyphens` needs it)
   **plus every other character the scanned pages really draw** (`--core-extra used`, default); extended = the unused
   headroom (rest of Latin-1/Ext-A, unused symbols, other scripts), fetched only when content that was not scanned needs it.
   Why used characters join the core: the browser shapes each font-face run separately, so when a character
   sits in another file than its neighbours, kerning/run-origin rounding at the boundary moves text by sub-pixel
   amounts (measured: a literal ASCII core changed 0.11 % of the pixels on an accent-dense page; `used-latin` -
   only accents in the core - still changed 0.09 % once a "EUR/trade mark" paragraph was added; no split: 0 px).
   Alternatives: `--core-extra used-latin` (only used U+0080-024F in the core) and `--core-extra none` (literal
   "ASCII + punctuation" core, smallest, accepts those diffs - the pixel diff will show them).
   **Rerun the scripts when content changes**: a new character outside the core is served from the extended file
   and may sit sub-pixel off. Pass `--paths` for every page that matters (`scan_paths` in fixtures). Each `@font-face` lists in `unicode-range` only code points the file contains.
6. **Verification** of every output (cmap, RFN leaks, hinting gone, axes as planned, kern kept) - it aborts on failure.

Outputs: `<stem>-core.woff2`, `<stem>-ext.woff2`, `fonts.generated.css`, `manifest.json`, optional `preload.html`.
Output is deterministic (rerunning gives byte-identical files).

### 4. Wire it in (by hand, source level)
Replace the original `@font-face` blocks that loaded the processed files with `fonts.generated.css` (or paste its rules
where the site declares fonts). Delete the old font files only after the diff passes. Keep `font-display`, metric
fallback faces and the font stack **exactly** as they are. If preloads are wanted and allowed, use `preload.html`
(core files only); if the site preloaded the original files, swap those links for the core ones. Frameworks:
- Plain/static: edit the CSS, copy files to the public dir.
- Astro Fonts API: put the optimised files in `src/assets/fonts`, one `variants` entry per `@font-face` in
  `fonts.generated.css` with its `unicodeRange`; replace `<Font preload />` by `<Font />` plus preload links built from
  `fontData` for the core files only (see the repo's `fixtures/astro/wire.py`).
- Next.js `next/font/local`: it cannot express a per-file `unicode-range`; use a plain `@font-face` from the generated CSS
  and keep the `adjustFontFallback` fallback face (see `fixtures/nextjs`).
- Never put a generated fallback face between the core and extended files of one family.

### 5. Prove nothing changed
Rebuild into `work/after/`, then:
```bash
python3 scripts/pixel_diff.py --before-dir work/before --after-dir work/after \
  --paths / /blog/ /docs/ --widths 390 1440 --schemes light dark --out work/diff
python3 scripts/pixel_diff.py --before-dir work/before --after-dir work/before --paths / --out work/noise --no-cls   # must be 0
```
Per page and viewport: PASS (0 px), TOLERATED (<= 0.02 % of pixels and max channel delta <= 16; each cluster listed with the
element under it), FAIL otherwise (also: page height changed, CLS > 0.1 or worse than +0.01 with every font response
delayed 1.5 s; a failing CLS is re-sampled 4x per side and the worst samples are compared, because delayed-font CLS flips between two values from run to run). Open `work/diff/img/*-diff.png` for any non-zero page. Explain each cluster as one of:
**content change** (e.g. a timestamp), **regression to fix** (missing glyph/feature/weight, wrong fallback), or
**harmless sub-pixel rounding** (only acceptable with the numbers in the report). Linux Chromium only: hinting
removal is invisible on macOS but can change Windows rendering - say so in the report.

### 6. Report
```bash
python3 scripts/measure_fonts.py --dir work/after --paths / /blog/ --out work/measure-after.json
python3 scripts/report.py --before work/measure-before.json --after work/measure-after.json \
  --manifest public/fonts/optimized/manifest.json --diff work/diff/pixel_diff.json --out work/report
```
Fill in `references/report-template.md` from `work/report.md`: bytes before/after per font and per page, pixel-diff
result, every deviation from the brief and what it costs, how to rerun (the exact commands above), and **when** to
rerun (new content with new characters, new weights/styles/features in the CSS, a font update, a new locale).
Confirm in the "after" measurement that extended files are fetched only on pages that need them.

## Gotchas
- Open every font with `recalcTimestamp=False` or output is not reproducible (the scripts do).
- All pieces of one family/style need the **same** `font-weight`/`font-stretch` descriptors: Chrome picks the face by
  those first and only then by unicode-range. The generated CSS copies the original descriptors for that reason.
- A subset of a variable font that pins `wght` at 400 will not synthesise bold; the scan's per-face union prevents this
  for observed weights. Unobserved weights are not preserved by design.
- Do not "optimise" CJK or other scripts the OS draws today; do not add web CJK fonts.
- Fonts under licences that forbid modification cannot be subset at all - stop and tell the user.
- Cross-boundary kerning between core and extended pieces is not applied (the browser shapes per face run); the
  pixel diff catches it. That is why every used character is in the core by default. Characters that only the
  extended file holds (unscanned content) can still lose a kern pair with their neighbour; rerun the scan, or use `--no-split`.
- Frameworks that derive a metric fallback from the font file (Astro Fonts API, `next/font/local`) compute
  `size-adjust` from the file's glyph widths, so a subset silently changes the fallback face and moves any
  character that still falls back (measured: Astro size-adjust 109.69 % -> 99.82 %, 1,200 px on a Turkish line).
  Re-declare the baseline's fallback faces verbatim (see `fixtures/astro/wire.py`, `fixtures/nextjs/wire.py`).
- Axes are trimmed to what the scan saw. Continuous axes (`opsz` follows font-size, `wght`) are only safe for sizes and
  weights present on scanned pages: a new 22.5 px italic heading would draw at the clamped `opsz`. Add every page
  and state to `--paths`, and rerun after design changes.
- Later, it may be worth inlining the core font in the global stylesheet and precaching extended files after idle.
