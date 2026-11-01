# Fixture: Next.js (static export) with Geist

- Next.js 16 App Router, `output: 'export'`, `next/font/local` for Geist Sans (roman + italic, variable) and Geist Mono (variable).
- Fonts: **Geist** by Vercel in collaboration with basement.studio, SIL OFL 1.1, copied unmodified from the
  `geist` npm package (see `LICENSE-geist.txt`). Geist declares no Reserved Font Name.
- `next/font` hashes the file names, and emits a metric-matched fallback face ("Geist Fallback"
  with `size-adjust` and the ascent/descent overrides). The optimised build must keep that fallback face.
- Pages: `/` (text, accents, italics, bold-in-italics, code, tabular numbers, a thin weight), `/blog/` (ASCII only: must
  not fetch the extended file), `/notes/` (not scanned; isolated ½ ¼ × ÷ ± boxes: fetches the extended file).
- `next/font/local` cannot give one file its own `unicode-range`, so `wire.py` replaces the `localFont` calls by plain
  `@font-face` rules (generated), keeping the same family names, CSS variables and the fallback faces.
