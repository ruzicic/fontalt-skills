# Scan details

`node scripts/scan-fonts.mjs <dir> [--json]`. Node.js 18+, built-in modules only. It reads files and writes stdout;
it opens no connection, runs no other program and never parses a font file (font files are listed by name only).

## What it reads, skips and detects

- **Reads:** `.css`, `.scss`, `.less`, `.html`, `.htm`, `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`,
  `.vue`, `.svelte`, `.astro`, `tailwind.config.*` and `package.json`. It lists `.woff2`, `.woff`, `.ttf`, `.otf` and
  `.eot` files without opening them.
- **Skips:** `node_modules`, `.git`, `dist`, `build`, `.next`, `out`, anything named `.env*`, files over 1 MB (listed
  in `stats.skipped_too_large`), symlinks that leave the root, and symlinked directories (not followed).
- **Not shipped, skipped by default** (folder names compared case-insensitively; listed in
  `stats.non_shipping_skipped`, at most 20, the rest counted in `stats.non_shipping_skipped_more`):
  - at any depth: `__tests__`, `__mocks__`, `fixtures`, `__fixtures__`, `cypress`, `playwright-report`,
    `test-results`, `coverage`, `.storybook`, `storybook-static` and the caches `.wrangler`, `.astro`, `.svelte-kit`,
    `.nuxt`, `.output`, `.vercel`, `.netlify`, `.turbo`, `.cache`;
  - only at the scan root or a workspace root (`apps/<name>`, `packages/<name>`): `test`, `tests`, `e2e`, `examples`,
    `docs`. Deeper down these are usually routes or components (`app/docs`, `src/routes/docs`) and are scanned. A
    `docs/` that a site generator publishes is scanned too: it holds `package.json`, `.vitepress`, `_config.yml`,
    `.nojekyll`, `conf.py`, `mint.json`, `docs.json` or `docusaurus.config.*`, or `mkdocs.yml` sits next
    to it;
  - files named `*.test.*`, `*.spec.*`, `*.stories.*`, `*.story.*`, or Cypress `*.cy.js`/`*.cy.ts` (not `about.cy.html`, a Welsh page) (counted in
    `stats.files_skipped_non_shipping`).

  Their font URLs and `@font-face` rules are test data or mock-ups. Font files inside skipped folders are not listed
  either. `--all` scans these folders and files; the skips above this list (`node_modules`, build output, `.env*`,
  files over 1 MB, symlinks) still apply.
- **Limit:** it reads at most 5,000 files, in sorted path order. At the 5,001st it stops and sets
  `stats.file_limit_reached: true`; the report must say the scan was partial.
- **Detects:** `@font-face` blocks; `font-family`, `font-weight`, `font-style`, `font-variation-settings` and the
  `font` shorthand (CSS, `<style>`, `style=""`), plus `fontFamily` / `fontWeight` / `fontStyle` in JS objects; Google
  Fonts `<link>` and `@import` URLs (parsed as text, never fetched); `next/font/google` and `next/font/local` calls;
  `@fontsource/*` and `@fontsource-variable/*` imports and dependencies; Tailwind `fontFamily` in `tailwind.config.*`
  and `--font-*` theme variables; Tailwind weight classes (`font-bold`, `font-[550]`); `<b>`, `<strong>`, `<th>` and
  `<h1>`–`<h6>`, which use weight 700 by default. Comments are ignored.

## JSON (`schema: "webfont-audit.scan/v1"`)

- `skill_version`: from `skill-version.txt`, `"unknown"` if missing. Cite this in the report.
- `families[]`, sorted by name:
  - `family`: the name as first seen. A CSS stack counts its first named family, plus any later one the project loads.
    Fontsource variable packages are named `"<Name> Variable"`; a `next/font/local` family is named from its first
    file (`Geist-Variable.woff2` gives `Geist`).
  - `weights_declared`: weights the project loads (`@font-face`, Google URL, `next/font` `weight`, Fontsource
    subpath). Numbers, then ranges as `"300..900"`, or `"variable"`.
  - `weights_used`: weights set in rules that name this family. Weights set without a family (`strong`, `.btn`,
    Tailwind classes) are in `stats.weights_used_unattributed`.
  - `italic_used`: italic or oblique in a rule naming the family, or italic requested from Google, `next/font` or
    Fontsource.
  - `axes_used`: four-letter axis tags from `font-variation-settings`, Google URLs or the `next/font` `axes` option.
  - `font_display`: `swap`, `fallback`, `optional`, `block`, `auto`, `missing`, `unknown`, a sorted array when the faces
    differ, or `null` when the scan found no web font load for the family (a system font, a Tailwind-only name).
  - `load_methods`: `font-face`, `font-face-local-only`, `google-fonts`, `next-font-google`, `next-font-local`,
    `fontsource`, `fontsource-variable`, `tailwind` (declared in Tailwind; does not load anything).
  - `font_files`: font files in the repo that this family's `url()` or `next/font/local` `src` points to.
  - `locations[{file,line}]`: every declaration and use. Paths are relative to the scanned root, with `/`.
- `findings[]`: `{ id, family, file, line, detail }`, sorted by file, line, id. `family` is `null` for one Google URL
  (its `detail` names the families) and for `mixed-cdn`.
- `stats`: `files_scanned`, `file_limit`, `file_limit_reached`, `max_file_bytes`, `files_skipped_too_large`,
  `skipped_too_large`, `symlinks_skipped`, `font_files_found`, `files_skipped_binary`, `weights_used_unattributed`,
  `families`, `findings`.

## Font-display rule v1

"Web font" means a face that downloads a file: an `@font-face` whose `src` has at least one `url()`, a Google Fonts
URL, or a `next/font` call. A face with only `local()` sources is a fallback face and is exempt.

| Value found | Verdict | Finding |
|---|---|---|
| `swap` | Pass. The default we recommend. | none |
| `fallback` | Pass. Text shows within about 100 ms; a late font is dropped after about 3 s. | none |
| `optional` | Pass (see below). | none |
| `block`, text family | Fail. Text can stay hidden for up to about 3 s. | `font-display-block` |
| `block`, icon family | Pass. The correct value for icons. | none |
| `auto` | Fail, same as missing: the browser decides, and in practice it behaves like `block`. | `missing-font-display` |
| missing (browser default `auto`) | Fail. | `missing-font-display` |
| not a literal keyword, or set where the scan cannot see | Not checked. | none; `font_display: "unknown"` |

**Icon family:** the name contains `icon`, `symbols`, `awesome`, `icomoon`, `fontello`, `codicon`, `feather`,
`lucide`, `phosphor` or `tabler` (case-insensitive). Missing or `auto` on an icon font gets `missing-font-display`
with `block` as the fix. `swap`, `fallback` and `optional` on an icon font get no finding.

| Load method | Value comes from | Missing means |
|---|---|---|
| `@font-face` (CSS, SCSS, Less, `<style>`, Vue, Svelte, Astro, JS strings) | the `font-display` descriptor | finding |
| Google Fonts `<link>` or `@import` URL | the `display=` parameter | finding (Google then serves no `font-display`) |
| `next/font/google`, `next/font/local` | the `display` option | pass: `next/font` defaults to `swap` |
| `@fontsource/*`, `@fontsource-variable/*` | not read (`node_modules` is skipped) | `"unknown"`, no finding |
| SCSS / Less variable, `var()` | not resolved | `"unknown"`, no finding |
| Tailwind `fontFamily` | does not load a font | not applicable |

One finding per `@font-face` block or `next/font` call; one per distinct Google Fonts URL in a file.

**Fallback metrics.** `font-display` decides when text is visible; fallback metrics decide how far it moves when the
web font arrives. The rule never trades one for the other: `swap` stays the default even with no metric fallback, and
the Reason sentence names the pairing so you propose both. The scan has no fallback-metrics finding (a text scan
cannot tell which fallback face a stack resolves to, and `next/font` and Astro build theirs). Before proposing a
fallback fix, read `visually-stable-font-fallbacks` at v1.0.0 (SKILL.md, section 4). Use `font-size-adjust` or a
`size-adjust` fallback face per family, not both stacked unless tested. Never claim a shift is fixed: that needs a
browser (block the web font and look, or `debug-optimize-lcp`). For a free font in our catalogue the report may link
the self-host kit, which outputs a `size-adjust` fallback for fonts we have measured:
`https://fontalternatives.com/tools/self-host-fonts/?font=<slug>&utm_source=webfont-audit&utm_medium=skill`.
`optimize-web-fonts` keeps a site's `font-display` as it is while shrinking files: the audit recommends, the
optimizer preserves.

**When `optional` is acceptable.** It always passes. Recommend it over `swap` only when all three hold: the page must
not shift and no metric-matched fallback is available; the font is preloaded or likely cached, so it usually arrives
inside the ~100 ms block period; a first visit rendered in the fallback is acceptable to the brand. Never recommend it
for an icon font, or for a face whose glyphs carry meaning the fallback lacks (a wordmark, a script it does not cover).

**Why this rule.** Google's guidance looks split: its LCP skill says to use `font-display: swap`, while its fallback
guide never mentions `font-display` and fixes layout shift with font metrics. They answer two different questions.
`font-display` decides when text becomes visible; fallback metrics decide how far it moves when the web font arrives.
Webfont Audit asks for both: show text straight away (`swap` by default, always written in the CSS) and stop the
movement with a metric-matched fallback. `optional` is fine when you would rather keep the fallback than swap late.
`block` is for icon fonts.

## Tree findings

Every font-display `detail` is four sentences joined by one space: observation, Rule, Reason, Fix. Rule and Reason are
constants in the script (`FONT_DISPLAY_RULE`, `FONT_DISPLAY_REASON`, `ICON_REASON`); icon cases use `ICON_REASON`.

- **`missing-font-display`**: a web font with no `font-display`, or `auto`. Observations (`{family}`, `{families}`):
  - `No font-display on this @font-face for "{family}": the browser default (auto) can hide the text for up to about
    3 seconds while the font downloads.` Fix: `add "font-display: swap;" to this rule.`
  - `font-display: auto on this @font-face for "{family}" is the same as leaving it out: ...` Fix: `change it to
    "font-display: swap;".`
  - `This Google Fonts URL ({families}) has no display parameter, ...` (or `sets display=auto`). Fix: `add
    "&display=swap" to the URL.` / `set "display=swap" in the URL.`
  - `next/font loads "{family}" with display: "auto": ...` Fix: `remove the display option (next/font defaults to
    "swap") or set display: "swap".`
  - Icon font: `This @font-face for "{family}", which looks like an icon font, has no font-display` (or `sets
    font-display: auto`) `, so the browser decides how the icons load.` Fix: `add "font-display: block;"` / `change it
    to "font-display: block;"`. A Google URL or `next/font` call for an icon font gets the same wording and `block`.
- **`font-display-block`**: `block` on a text family (`@font-face`, Google `display=block`, `next/font`). Fix: `change
  it to "font-display: swap;". Keep block only if "{family}" is an icon font.` (or the URL / `next/font` fix above).
- **`render-blocking-google-css`**: a Google Fonts `<link rel="stylesheet">` (HTML, JSX, Vue, Svelte, Astro) whose
  `media` is absent, `all` or `screen` and that is not inside `<noscript>`; or any `@import` of
  `fonts.googleapis.com`. A link with `media="print"` and an `onload` swap, or `rel="preload"`, passes. Its copy never
  mentions font-display; a blocking URL with no `display=` gets both findings.
- **`unused-face-weight`**: a single weight the project loads for a family (`@font-face`, Google URL, `next/font`
  `weight`, Fontsource subpath) that nothing in the scanned files sets where the family could apply: neither a rule
  naming the family nor a family-less weight (`strong`, `.btn`, Tailwind classes, `--*weight*` variables). Kept
  conservative: never 400, never a range or variable font, never an icon family, only for a family the project uses,
  and switched off entirely when it sees `bolder` / `lighter`, or `var()` weights with no `--*weight*` variable.
- **`nextfont-subset-mismatch`**: a `next/font/google` call with preload on (the default) and no or empty `subsets`
  (Next.js needs them to choose the preload files); or, when calls declare different subsets, each call that lacks a
  subset another call preloads (text in that subset gets a file that is not preloaded and can swap in late).
- **`mixed-cdn`**: web fonts load from two or more origins. Origins are the hosts of Google Fonts URLs (with
  `fonts.gstatic.com`), other font stylesheets (`use.typekit.net`, `api.fontshare.com`, `fonts.bunny.net`, or any
  external stylesheet or `@import` whose URL mentions "font"), absolute `url()`s in `@font-face`, and "self-hosted"
  for repo files, `next/font` and Fontsource. One finding, at the first use of the second origin.

## Catalogue findings (from `resolve_fonts`)

`catalogueFindings(scan, resolveResponse, licences?)` in the script does this mapping; it is a pure function and
the tests pin it against a frozen response. Each result is matched to a family by its `query`; a family that was
not sent is skipped. `generic` gives nothing.

- **`not-in-catalogue`**: `not_in_catalogue` or `ambiguous`. Not a problem, only "not checked"; candidates are listed.
- **`weight-not-available`**: for `found`, every number in `weights_declared` and `weights_used` that is neither in
  `weights` nor inside the `wght` axis range. Copy ends `the browser will substitute the nearest weight or synthesize
  it`. Skipped when both `weights` and `variable_axes` are `"unknown"`.
- **`italic-not-available`**: `italic_used` and `italics: false`. Never for `"unknown"`.
- **`axis-not-available`**: a tag in `axes_used` missing from `variable_axes` (`[]` means a static font). Never for
  `"unknown"`.
- **`licence-flags`**: one per found family. Free fonts: the `license_id`, then the flags when `lookup_license` data is
  passed in (a follow-up), else the licence guide link. When the repo holds font files for the family and the licence
  forbids modification or redistribution (ITF FFL: from `lookup_license`, or the script's `KNOWN_LICENCE_FLAGS` copy
  of the catalogue's stored flags), it names "no modifying, subsetting or converting" and "no redistributing", then
  the official URL. Premium and system fonts: "our data holds no licence terms" and the catalogue page. Wording
  rules: `licence-notes.md`.
