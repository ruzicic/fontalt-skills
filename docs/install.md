# Install

Two skills live in this repo, each a folder under `skills/` (a `SKILL.md` plus `scripts/` and `references/`) in the
[Agent Skills](https://agentskills.io) format: `webfont-audit` and `optimize-web-fonts`.

## Install with one command

```bash
npx skills add ruzicic/fontalt-skills --skill webfont-audit
npx skills add ruzicic/fontalt-skills --skill optimize-web-fonts
```

- `-g`: install for all your projects instead of this one.
- `-a claude-code`: install for one agent only (for example `-a cursor` or `-a codex`).
- `-y`: no prompts.
- `--list`: show the skills in the repo without installing (`npx skills add ruzicic/fontalt-skills --list`).

## Connect the MCP server (webfont-audit only, optional)

```bash
claude mcp add --transport http fontalternatives https://mcp.fontalt.com/mcp
```

Any other client: add an HTTP MCP server at `https://mcp.fontalt.com/mcp`, no key. Without it, `webfont-audit` still
gives every finding it can make from your files and marks the catalogue checks "not checked".

## Requirements

`webfont-audit` needs Node.js 18+ and nothing else: no install step, no dependencies.

`optimize-web-fonts` needs Python and Playwright:
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r skills/optimize-web-fonts/requirements.txt
playwright install chromium
```
Python 3.10+. The scripts also run by hand without an agent: see the README of this repo.

## Manual install (fallback)

Copy or symlink the skill folder where your agent looks for skills. Replace `<skill>` with `webfont-audit` or
`optimize-web-fonts`.

### Claude Code
```bash
git clone https://github.com/ruzicic/fontalt-skills.git
# for one project:
mkdir -p .claude/skills && cp -r fontalt-skills/skills/<skill> .claude/skills/
# or for every project:
mkdir -p ~/.claude/skills && cp -r fontalt-skills/skills/<skill> ~/.claude/skills/
```
Then ask the agent to use the skill, for example "Audit this project's web fonts" or "Optimize this site's web fonts".

### Cursor
Cursor loads skills from `.agents/skills/` or `.cursor/skills/` (project) and `~/.agents/skills/` or `~/.cursor/skills/`
(global) - [docs](https://cursor.com/docs/skills). It also reads the Claude and Codex directories.
```bash
mkdir -p .agents/skills && cp -r fontalt-skills/skills/<skill> .agents/skills/      # project, shared with Codex
# or global: mkdir -p ~/.cursor/skills && cp -r fontalt-skills/skills/<skill> ~/.cursor/skills/
```
Then ask the agent to use the skill.

### Codex CLI
Codex scans `.agents/skills/` from the working directory up to the repo root, plus `~/.agents/skills/` for you personally
([docs](https://learn.chatgpt.com/docs/build-skills.md)). Older releases used `~/.codex/skills`, which is still read.
```bash
mkdir -p .agents/skills && cp -r fontalt-skills/skills/<skill> .agents/skills/      # project
# or personal: mkdir -p ~/.agents/skills && cp -r fontalt-skills/skills/<skill> ~/.agents/skills/
```
Then ask: "Use the <skill> skill on this site."
