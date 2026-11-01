# Credits

- **Shu Ding** ([@shuding](https://x.com/shuding), Vercel): the approach - measure, find what is really used, cut each font
  down, split a preloaded core from an `unicode-range` extended file, and prove it with pixel diffs - comes from his
  prompt, posted at https://x.com/shuding/status/2115855028737200211 . This repo turns that prompt into an Agent Skill
  with runnable scripts. All credit for the idea and the checklist goes to him.
- Built by [FontAlternatives](https://fontalternatives.com) - font pairings and free alternatives to paid fonts.
- Fonts in the test fixtures are SIL OFL 1.1 and ship with their licences:
  Source Serif 4 (Adobe, Reserved Font Name "Source"), JetBrains Mono (JetBrains), Atkinson Hyperlegible (Braille Institute of America, via Fontsource), Geist (Vercel / basement.studio).
- Tools: [fontTools](https://github.com/fonttools/fonttools) (subset, varLib.instancer), [Brotli](https://github.com/google/brotli), [Playwright](https://playwright.dev), NumPy, Pillow.
