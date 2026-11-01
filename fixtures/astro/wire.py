"""How the optimised files go back into the Astro fixture (called by tests/run_fixture.py on a copy of the project).

Stays inside Astro's Fonts API (hashed asset URLs, `fontData`), with one exception: the metric-matched fallback faces.
Astro derives their size-adjust from the average glyph width of the font FILE, so a subset changes them (measured:
size-adjust 109.69% -> 99.82%, which moved the Arial-fallback glyphs of a Turkish line). `wire` therefore turns
`optimizedFallbacks` off and re-declares the baseline's four fallback faces verbatim under fixed names.
  Steps:
  * the optimised .woff2 files replace the originals in src/assets/fonts/ and become `variants` with a `unicodeRange`
    each (core + extended pieces of every original face);
  * `<Font cssVariable="--font-atkinson" preload />` (preloads every variant, ext files included) becomes `<Font ... />`
    plus explicit preload links for the core files only, taken from `fontData` so the URLs are Astro's own.
"""
import re
import shutil
from pathlib import Path

BLOCK = re.compile(r"@font-face\s*\{(.*?)\}", re.S)


def parse_faces(manifest):
    faces = []
    for f in manifest["files"]:
        for css in f["css"]:
            body = BLOCK.search(css).group(1)
            get = lambda k: re.search(rf"{k}:\s*([^;]+);", body).group(1).strip()
            faces.append({"file": re.search(r'url\("[^"]*?([^/"]+)"\)', body).group(1), "weight": get("font-weight"),
                          "style": get("font-style"), "range": get("unicode-range")})
    return faces


FALLBACK = re.compile(r'@font-face\{font-family:"[^"]*? fallback: (Arial(?: Bold)?)";([^}]*)\}')


def baseline_fallbacks(dist: Path):
    """The four fallback @font-face rules Astro generated for the baseline, keyed to fixed family names."""
    html = next(dist.rglob("index.html")).read_text()
    rules = []
    for m in FALLBACK.finditer(html):
        rules.append('@font-face{font-family:"Atkinson Pinned %s";%s}' % (m.group(1), m.group(2)))
    assert len(rules) >= 4, "baseline fallback faces not found"
    return list(dict.fromkeys(rules))


def wire(proj: Path, opt: Path, ctx: dict):
    rules = baseline_fallbacks(ctx["before_dist"])
    css = proj / "src/styles/global.css"
    css.write_text(css.read_text() + "\n/* fallback faces pinned to the baseline's metrics */\n" + "\n".join(rules) + "\n")
    manifest = ctx["manifest"]
    faces = parse_faces(manifest)
    fonts_dir = proj / "src/assets/fonts"
    shutil.rmtree(fonts_dir)
    fonts_dir.mkdir(parents=True)
    for p in opt.glob("*.woff2"):
        shutil.copy(p, fonts_dir / p.name)

    variants = ",\n".join(
        f"\t\t\t\t\t{{ src: ['./src/assets/fonts/{f['file']}'], weight: {f['weight']}, style: '{f['style']}', display: 'swap', "
        f"unicodeRange: ['{f['range']}'] }}" for f in faces)
    cfg = proj / "astro.config.mjs"
    s = cfg.read_text()
    s = re.sub(r"const LATIN = .*?\n\}\);\n", "", s, flags=re.S)  # the face() helper and its constants
    s = re.sub(r"variants: \[.*?\n\t\t\t\t\],", "variants: [\n" + variants.replace("\\", "\\\\") + ",\n\t\t\t\t],", s, flags=re.S)
    s = s.replace("fallbacks: ['sans-serif'],",
                  "fallbacks: ['Atkinson Pinned Arial', 'Atkinson Pinned Arial Bold', 'sans-serif'],\n\t\t\toptimizedFallbacks: false,")
    assert "optimizedFallbacks" in s
    cfg.write_text(s)

    core_names = {Path(u).name for u in manifest["preload_replacements"].values()}
    idx = [i for i, f in enumerate(faces) if f["file"] in core_names]
    head = proj / "src/components/BaseHead.astro"
    h = head.read_text()
    h = h.replace("import { Font } from 'astro:assets';", "import { Font, fontData } from 'astro:assets';")
    h = h.replace("---\n\n<!-- Global Metadata -->",
                  f"const corePreloads = {idx}.map((i) => fontData['--font-atkinson'][i].src[0].url);\n---\n\n<!-- Global Metadata -->", 1)
    h = h.replace('<Font cssVariable="--font-atkinson" preload />',
                  '<Font cssVariable="--font-atkinson" />\n'
                  '{corePreloads.map((href) => <link rel="preload" href={href} as="font" type="font/woff2" crossorigin />)}')
    head.write_text(h)
