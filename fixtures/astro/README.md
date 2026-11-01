# Astro fixture

The official Astro `blog` starter (MIT, © Astro contributors) with one change: the font.
The starter ships Atkinson Hyperlegible under a "no derivatives" licence, so this fixture uses the
**SIL OFL 1.1** build of Atkinson Hyperlegible from Google Fonts (via `@fontsource/atkinson-hyperlegible` 5.3.0,
licence in `LICENSE-atkinson-hyperlegible.txt`) — latin + latin-ext, regular/bold, normal/italic, declared with
Astro's Fonts API exactly the way Google Fonts / fontsource ship them, with `<Font cssVariable="--font-atkinson" preload />`
(preloads every variant: the "before" state).
An extra post (`typography-notes`) exercises accents, extended Latin, italics and a table.
`wire.py` shows how the optimised files are fed back through Astro's own font pipeline.
