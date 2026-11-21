# Licence notes

The catalogue stores a summary of each licence's published terms. Report what it stores, link the official text, and
stop there. You are not judging the user's project.

## Wording rules

- Report the licence on record, the stored flags and the official licence URL. Nothing more.
- Never write "compliant", "in breach", "violates", "allowed for your project", "you may" or "you must". Write "the
  stored flags say …" and "read the official licence before …".
- A licence id or flag that is `null` or `"unknown"` is "not in our data". Never guess a licence from a font's name,
  foundry or source.
- Premium and system fonts have `license_id: null`: say our data holds no licence terms for them and that their licence
  comes from the foundry or vendor the user got them from. Do not guess what that licence allows.
- Always print the disclaimer from the report ending, even when no licence finding was made.

## The six flags (`lookup_license`)

| Flag | What `true` means in the stored summary |
|---|---|
| `commercial_use` | The font may be used in commercial work. |
| `modification_allowed` | The font files may be modified. Subsetting and converting (for example TTF to WOFF2) are modifications. |
| `redistribution_allowed` | The font files may be passed on to others, which includes serving copies from a public site or repo. |
| `attribution_required` | The licence asks for a credit or notice somewhere (often only when the files are redistributed). |
| `copyleft` | Modified versions must keep the same licence. |
| `can_sell_font` | The font files themselves may be sold. |

A default audit makes one `resolve_fonts` call, which returns `license_id` only. The flags come from `lookup_license`,
which the agent calls only when the user asks a follow-up, so a default `licence-flags` finding links the licence guide
instead. The exception is below.

## ITF Free Font License (ITF FFL)

Fontshare's Indian Type Foundry fonts (Satoshi, General Sans, Cabinet Grotesk, Clash Display and others) use the
`ITF Free Font License`. The catalogue stores `commercial_use: true`, `modification_allowed: false` and
`redistribution_allowed: false`. The official text is at https://www.fontshare.com/licenses/itf-ffl.

- When the repo holds font files for an ITF FFL family (`families[].font_files` is not empty), the `licence-flags`
  finding names the flags: no modifying, subsetting or converting the font files, and no redistributing them. The
  script carries a copy of these two stored flags (`KNOWN_LICENCE_FLAGS`), so this works without a `lookup_license`
  call.
- Subset files (a `unicode-range` face, "subset" in the name) and converted files (a format the foundry did not ship)
  are the cases to point out. Say which files they are; do not say whether the user may keep them.
- Self-hosting is not in itself a problem to report: the stored summary says the official files may be self-hosted.
- Do not suggest `optimize-web-fonts` (it subsets) for an ITF FFL family. Point to the official licence instead.

## Reserved Font Names (OFL)

`resolve_fonts` does not return Reserved Font Names. On a follow-up, `get_font` returns `reserved_font_names` in one
of three states:

- an array of names: reviewed, and these names are reserved. A modified (for example subset) copy must not use them;
- `[]`: reviewed, and none are declared;
- `"unknown"`: not in our data. Say so; do not assume either way.

## AGPL and other copyleft licences

Report the flags and the official URL, then stop. Do not explain what copyleft means for the user's codebase.
