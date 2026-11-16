# Install

The skill is the folder `skills/optimize-web-fonts/` (a `SKILL.md` plus `scripts/` and `references/`), in the
[Agent Skills](https://agentskills.io) format. Copy or symlink that folder where your agent looks for skills.

## Claude Code
```bash
git clone https://github.com/ruzicic/fontalt-skills.git
# for one project:
mkdir -p .claude/skills && cp -r fontalt-skills/skills/optimize-web-fonts .claude/skills/
# or for every project:
mkdir -p ~/.claude/skills && cp -r fontalt-skills/skills/optimize-web-fonts ~/.claude/skills/
```
Then ask: "Optimize this site's web fonts" (or run `/optimize-web-fonts`).

## Cursor
Cursor loads skills from `.agents/skills/` or `.cursor/skills/` (project) and `~/.agents/skills/` or `~/.cursor/skills/`
(global) - [docs](https://cursor.com/docs/skills). It also reads the Claude and Codex directories.
```bash
mkdir -p .agents/skills && cp -r fontalt-skills/skills/optimize-web-fonts .agents/skills/      # project, shared with Codex
# or global: mkdir -p ~/.cursor/skills && cp -r fontalt-skills/skills/optimize-web-fonts ~/.cursor/skills/
```
Then ask the agent to optimize the site's web fonts.

## Codex CLI
Codex scans `.agents/skills/` from the working directory up to the repo root, plus `~/.agents/skills/` for you personally
([docs](https://learn.chatgpt.com/docs/build-skills.md)). Older releases used `~/.codex/skills`, which is still read.
```bash
mkdir -p .agents/skills && cp -r fontalt-skills/skills/optimize-web-fonts .agents/skills/      # project
# or personal: mkdir -p ~/.agents/skills && cp -r fontalt-skills/skills/optimize-web-fonts ~/.agents/skills/
```
Then ask: "Use the optimize-web-fonts skill on this site."

## Python dependencies (any agent)
```bash
python3 -m venv .venv && . .venv/bin/activate
pip install -r skills/optimize-web-fonts/requirements.txt
playwright install chromium
```
Python 3.10+. The scripts also run by hand without an agent: see the README of this repo.
