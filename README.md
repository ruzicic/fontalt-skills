# font-skills

Two agent skills for web fonts, by FontAlternatives.

| Skill | What it does | What it needs |
|---|---|---|
| [`webfont-audit`](skills/webfont-audit/SKILL.md) | Audits the web fonts a repo declares and uses, from its source files: font-display, unused weights, render-blocking Google Fonts CSS, weights, italics and axes a font does not have, licence flags. | Node.js 18+ |
| [`optimize-web-fonts`](skills/optimize-web-fonts/SKILL.md) | Shrinks a site's web font bytes (subset, split, trim) and proves nothing changed with pixel diffs. | Python 3.10+ and Playwright |

## Install

```bash
npx skills add ruzicic/font-skills --skill webfont-audit
npx skills add ruzicic/font-skills --skill optimize-web-fonts
```

See both skills with `npx skills add ruzicic/font-skills --list`.

Optional, for the `webfont-audit` catalogue and licence checks:

```bash
claude mcp add --transport http fontalternatives https://mcp.fontalt.com/mcp
```

Other agents and manual install: [`docs/install.md`](docs/install.md).

## webfont-audit

Ask your agent to "audit this project's web fonts". The skill runs a zero-dependency Node script over your source
files (CSS, SCSS, Less, HTML, JS/TS, Vue, Svelte, Astro, Tailwind config, `package.json`) and lists every font,
weight and loading method. From the files alone it reports a missing or `auto` font-display, `font-display: block` on
a text font, weights you load but never use, render-blocking Google Fonts CSS, `next/font` subset mismatches and fonts
split across more than one origin. With the optional MCP server connected it adds the catalogue checks: weights,
italics or axes a font does not have, the licence on record with its official text, and fonts that are not in our
data.

The scan runs on your machine and makes no network request. If you connect the MCP server, your agent sends it font
family names and nothing else: no files, paths, URLs or repo name. No account or key.

**Why this rule.** Google's guidance looks split: its LCP skill says to use `font-display: swap`, while its fallback
guide never mentions `font-display` and fixes layout shift with font metrics. They answer two different questions.
`font-display` decides when text becomes visible; fallback metrics decide how far it moves when the web font arrives.
Webfont Audit asks for both: show text straight away (`swap` by default, always written in the CSS) and stop the
movement with a metric-matched fallback. `optional` is fine when you would rather keep the fallback than swap late.
`block` is for icon fonts.

Workflow and rules: [`skills/webfont-audit/SKILL.md`](skills/webfont-audit/SKILL.md). Tests (Node built-ins only):

```bash
node --test tests/webfont-audit/*.test.mjs
```

## optimize-web-fonts

An agent skill, `skills/optimize-web-fonts`, that shrinks a site's web font bytes (measure, scan real usage with
Playwright, subset / split with fontTools, pixel-diff) without changing how anything looks. See
`skills/optimize-web-fonts/SKILL.md` for the workflow and `docs/install.md` for installation.

### Results

Each fixture was run end to end from scratch three times (`tests/run_fixture.py <fixture> --runs 3`).
Pass = 0 differing pixels (up to 0.02 % of a screenshot tolerated and explained), CLS <= 0.1 and not worse than
baseline + 0.01, >= 20 % fewer font bytes, byte-identical optimizer output, noise floor 0 px.
Per-run numbers: `results/<fixture>.json`.

| Fixture | Font bytes before | Font bytes after | Saved | Differing px (run 1 / 2 / 3) | Worst CLS (before -> after) | Runs green |
|---|---:|---:|---:|---|---|---|
| plain-html (Source Serif 4 + JetBrains Mono) | 2,634,784 | 906,336 | 65.6 % | 0 / 0 / 0 | 0.00163 -> 0.00163 | 3/3 |
| astro (Atkinson Hyperlegible, Fonts API) | 1,099,800 | 300,032 | 72.7 % | 3 / 3 / 0 | 0.09762 -> 0.09762 | 3/3 |
| nextjs (`next/font/local`) | 1,286,112 | 377,704 | 70.6 % | 0 / 0 / 0 | 0.03358 -> 0.03358 | 3/3 |

Notes:
- astro runs 1 and 2: 3 single pixels (0.00016 % of the screenshot) on `/about/` at 390 px dark, at the right edge of
  an element that overflows the viewport; run 3 with identical inputs gave 0. Treated as raster noise at the overflow edge.
- CLS is measured with every font response delayed 1.5 s and is bimodal from run to run on some pages (unchanged
  baseline pages flip between two values), so a failing CLS is re-sampled and worst compared with worst.
- Linux Chromium 143 only (Playwright 1.57.0); hinting removal is not checked on other platforms.
- `--axes trim` is not part of the pass criteria (it changes pixels on text-heavy pages); it stays off by default.

### Reproduce

```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r skills/optimize-web-fonts/requirements.txt
playwright install chromium            # or use the cached Chromium matching Playwright 1.57.0
python tests/run_fixture.py plain-html --runs 3     # astro needs Node >= 22.23.4 on PATH (FONT_SKILLS_NODE_BIN)
```

Licences: `LICENSE`, `CREDITS.md`, and the font licences in each fixture.

## Credits

The `optimize-web-fonts` skill is based on [Shu Ding's font-optimization prompt](https://x.com/shuding/status/2115855028737200211). Thank you, Shu. See [CREDITS.md](CREDITS.md) for details.

Built and maintained by [FontAlternatives.com](https://fontalternatives.com), free alternatives to premium fonts.

## License

MIT, see [LICENSE](LICENSE). Fixture fonts keep their own OFL licences.
