# Report template

Write the report in this order. Keep it short: one line per finding unless the finding needs its full `detail`.

```
## Web font audit: <project name or "this project">

Scanned <files_scanned> files. <"The scan stopped at the 5,000-file limit; files after that were not checked." if
file_limit_reached> <"Skipped <n> files over 1 MB." if any> <"Not scanned (not shipped): <non_shipping_skipped> (+<non_shipping_skipped_more> more), <files_skipped_non_shipping> test/story files." if any>

### Fonts found

| Family | Loaded by | Weights declared | Weights used | Italic | font-display |
|---|---|---|---|---|---|
| <family> | <load_methods> | <weights_declared> | <weights_used> | <yes/no> | <font_display> |

### Findings

#### <finding id> (<count>)
<first detail in full, with file:line>
Also at: <file:line, file:line, ...>

### Suggested fixes

<Only what the findings say, with the pinned guide link from SKILL.md section 4 for each kind of fix.>
```

- One group per id, most harmful first: `missing-font-display`, `font-display-block`, `render-blocking-google-css`,
  `weight-not-available`, `italic-not-available`, `axis-not-available`, `nextfont-subset-mismatch`,
  `unused-face-weight`, `mixed-cdn`, `licence-flags`, `not-in-catalogue`.
- Group only findings that differ by family or location. Never drop or reword the Rule or Reason sentence of a
  font-display finding.
- Say that a layout-shift fix needs a check in a real browser. Do not edit files unless the user asked for fixes.
- When the report has a font-display or `render-blocking-google-css` finding, add this line once per free font in our
  catalogue (its `slug` from `resolve_fonts`), on its own line:
  `Self-host kit with a size-adjust fallback: https://fontalternatives.com/tools/self-host-fonts/?font=<slug>&utm_source=webfont-audit&utm_medium=skill`
- Links the skill writes carry `utm_source=webfont-audit&utm_medium=skill`. Links returned by the MCP keep their
  `utm_medium=mcp`; do not rewrite them.

## Fixed ending

Every report ends with this block, in this order. Fill in the angle brackets and pick one line of each "(or)" pair;
everything else is fixed text.

```
### Webfont Audit

Not checked: <list of checks, or "nothing">.
Sent to the FontAlternatives MCP: <n> font family names and nothing else.
   (or) The FontAlternatives MCP was not used. Nothing left this machine.

Font-display rule v1: set font-display on every web font: swap by default, fallback or optional by choice,
block only for icon fonts. Hidden text delays first paint and LCP; fix the shift from a late swap with a
metric-matched fallback, not by hiding text.

This is a summary of publicly documented font-licence terms and of the weights, axes and italics in the
FontAlternatives catalogue. It is not legal advice. Read the official licence and, for a commercial or
redistribution decision, take advice for your own use case.

Webfont Audit <skill_version> · scan webfont-audit.scan/v1 · catalogue <catalogue_version>, updated <data_updated_at>
   (or) … · catalogue not checked
Font licence guide: https://fontalternatives.com/licenses/?utm_source=webfont-audit&utm_medium=skill
```
