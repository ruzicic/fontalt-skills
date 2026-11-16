# fontalt-skills

An agent skill, `skills/optimize-web-fonts`, that shrinks a site's web font bytes (measure, scan real usage with
Playwright, subset / split with fontTools, pixel-diff) without changing how anything looks. See
`skills/optimize-web-fonts/SKILL.md` for the workflow and `docs/install.md` for installation.

## Results

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

## Reproduce

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
