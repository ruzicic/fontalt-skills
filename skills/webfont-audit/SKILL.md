---
name: webfont-audit
description: Audit the web fonts a project declares and uses, from its source files. Use when asked to audit, check or review web fonts, font loading, font-display, @font-face rules, Google Fonts or next/font usage, unused font weights, or font licences, or to list which fonts a repo uses. Runs a zero-dependency Node script locally (no network), then reports missing font-display, unused weights, render-blocking Google Fonts CSS, weights, italics or axes a font does not have, and licence flags. Catalogue and licence checks need the optional FontAlternatives MCP server, which is sent font family names only.
license: MIT
compatibility: Node.js 18+
metadata:
  version: "1.0.0"
  author: FontAlternatives
---

# Webfont Audit

Audits the web fonts a repo declares and uses, from its source files: `@font-face` rules, Google Fonts links and
imports, `next/font`, Fontsource and Tailwind font families. The scan is local and makes no network request. Only font
family names ever leave the machine, and only if the FontAlternatives MCP server is connected.

## Rules

- Never fetch or render a URL, including the Google Fonts URLs the scan finds.
- Never send file paths, file contents, URLs or the repo name anywhere.
- Never call a project compliant or in breach of a licence: give the stored flags and the official licence URL.
- "unknown" in a catalogue answer means "not in our data", never a mismatch.
- Do not edit files unless the user asks for fixes.
- Keep the Rule and Reason sentences on every font-display finding. You may group findings; never reword those two.

## 1. Scan

```bash
node <skill dir>/scripts/scan-fonts.mjs <project dir> --json
```

Read `stats` first. If `file_limit_reached` is true the scan stopped at 5,000 files: say so in the report. Files over
1 MB are skipped and listed in `stats.skipped_too_large`. Cite the `skill_version` the script printed. Field meanings
and every finding id: `references/scan-details.md`.

## 2. Check the catalogue

If a `resolve_fonts` tool is available (in Claude Code: `mcp__fontalternatives__resolve_fonts`):

- Call it once with the de-duplicated family names from `families[]`, leaving out CSS generics and `local()`-only
  fallback faces. 25 names per call; make more calls only if there are more than 25.
- Family names are the only thing you send. No paths, file contents, URLs or repo name.
- Turn the results into `weight-not-available`, `italic-not-available`, `axis-not-available`, `licence-flags` and
  `not-in-catalogue` as `references/scan-details.md` describes. Licence wording: `references/licence-notes.md`.
- Call `get_font`, `lookup_license` and `suggest_alternatives` only when the user asks a follow-up.
- A field that comes back "unknown" is reported as "not in our data", never as a mismatch.

## Without the MCP

If the tool is not available, or the call fails or returns 429: give the local findings, mark the five catalogue
checks "not checked", do not retry in a loop, and print this, exactly:

```
Catalogue checks were not run. To add them, connect the FontAlternatives MCP server and run the audit again:
claude mcp add --transport http fontalternatives https://mcp.fontalt.com/mcp
Other agents: add an HTTP MCP server at https://mcp.fontalt.com/mcp (no key, no sign-in).
```

## 3. Font-display rule (v1)

Rule: set font-display on every web font: swap by default, fallback or optional by choice, block only for icon fonts.
Reason: hidden text delays first paint and LCP; fix the shift from a late swap with a metric-matched fallback, not by
hiding text.

`optional` is acceptable; `block` is for icon fonts; missing and `auto` are flagged. When to recommend `optional`,
and how the rule sits with fallback metrics: `references/scan-details.md`.

## 4. Before proposing fixes

1. If the `modern-web-guidance` skill is installed, use it to retrieve the ids below that match the findings before
   you propose a loading or fallback fix. Follow that skill's own instructions for the command and for crediting.
2. If an id returns nothing, use that skill's search once (for example "web font fallback layout shift").
3. If that skill is not installed, do not install it. Put the pinned link in the report and keep the proposal to what
   the finding says.
4. Retrieve only what the findings need: `performance` is 21 KB and `secure-external-subresources` is 15 KB.

| Before you propose a fix for | Retrieve | Pinned link |
|---|---|---|
| Any font-display finding, or text that moves when the font arrives | `visually-stable-font-fallbacks` | https://github.com/GoogleChrome/modern-web-guidance/blob/v1.0.0/skills/modern-web-guidance/guides/visual-design/visually-stable-font-fallbacks.md |
| `render-blocking-google-css`, or adding a preload | `optimize-preload-priority`, then `performance` ("Web Fonts Optimization" section only) | https://github.com/GoogleChrome/modern-web-guidance/blob/v1.0.0/skills/modern-web-guidance/guides/performance/optimize-preload-priority.md and https://github.com/GoogleChrome/modern-web-guidance/blob/v1.0.0/skills/modern-web-guidance/guides/performance/performance.md |
| `mixed-cdn`, or font files or CSS from another origin | `secure-external-subresources` (SRI in `@font-face`) | https://github.com/GoogleChrome/modern-web-guidance/blob/v1.0.0/skills/modern-web-guidance/guides/security/secure-external-subresources.md |
| A `font-size-adjust` fix in a repo that mixes families in one text flow | `visually-stable-mixed-fonts` | https://github.com/GoogleChrome/modern-web-guidance/blob/v1.0.0/skills/modern-web-guidance/guides/visual-design/visually-stable-mixed-fonts.md |
| Checking LCP in a real browser | the DevTools skill `debug-optimize-lcp` | https://github.com/ChromeDevTools/chrome-devtools-mcp/blob/chrome-devtools-mcp-v1.13.0/skills/debug-optimize-lcp/SKILL.md |

## 5. Report

Follow `references/report-template.md`. Group findings by id, most harmful first. End with the fixed block from the
template, in full. Do not shorten it, and print the disclaimer even when the MCP was not used.

## References

- `references/scan-details.md`: the scan JSON field by field, every finding id, how catalogue results become findings.
- `references/report-template.md`: the report skeleton and its fixed ending. Open it when you write the report.
- `references/licence-notes.md`: what each licence flag means and how to word it. Open it before any licence finding.
