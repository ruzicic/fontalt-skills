// SKILL.md budgets, pinned links, fixed copy, and the scanner's no-network source check.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { SCRIPT, SKILL_DIR } from "./helpers.mjs";
import { FONT_DISPLAY_REASON, FONT_DISPLAY_RULE } from "../../skills/webfont-audit/scripts/scan-fonts.mjs";

const skillMd = fs.readFileSync(path.join(SKILL_DIR, "SKILL.md"), "utf8");
const lines = skillMd.replace(/\n$/, "").split("\n");

function skillFiles(dir = SKILL_DIR) {
	return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? skillFiles(path.join(dir, e.name)) : [path.join(dir, e.name)]));
}
const allSkillText = skillFiles().map((f) => [f, fs.readFileSync(f, "utf8")]);

function frontmatter() {
	const m = skillMd.match(/^---\n([\s\S]*?)\n---\n/);
	assert.ok(m, "frontmatter");
	return m[1];
}

function fencedAfter(text, heading) {
	const at = text.indexOf(heading);
	assert.ok(at >= 0, heading);
	const m = text.slice(at).match(/```[a-z]*\n([\s\S]*?)\n```/);
	return m[1];
}

// DESIGN 2.6, verbatim.
const MCP_ABSENT = `Catalogue checks were not run. To add them, connect the FontAlternatives MCP server and run the audit again:
claude mcp add --transport http fontalternatives https://mcp.fontalt.com/mcp
Other agents: add an HTTP MCP server at https://mcp.fontalt.com/mcp (no key, no sign-in).`;

// DESIGN 2.7, verbatim.
const REPORT_ENDING = `### Webfont Audit

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
Font licence guide: https://fontalternatives.com/licenses/?utm_source=webfont-audit&utm_medium=skill`;

test("SKILL.md budget: at most 100 lines and 7 KB", () => {
	assert.ok(lines.length <= 100, `${lines.length} lines`);
	assert.ok(Buffer.byteLength(skillMd) <= 7 * 1024, `${Buffer.byteLength(skillMd)} bytes`);
});

test("SKILL.md lines wrap at 120 characters (URL lines and the one-line frontmatter description excepted)", () => {
	const fm = frontmatter().split("\n").length + 2;
	lines.forEach((l, i) => {
		if (l.length <= 120 || /https?:\/\//.test(l)) return;
		if (i < fm && l.startsWith("description: ")) return; // DESIGN 2.1 gives the description as one YAML line
		assert.fail(`line ${i + 1} is ${l.length} characters`);
	});
});

test("frontmatter is DESIGN 2.1", () => {
	const fm = frontmatter();
	assert.match(fm, /^name: webfont-audit$/m);
	assert.match(fm, /^license: MIT$/m);
	assert.match(fm, /^compatibility: Node\.js 18\+$/m);
	assert.match(fm, /^metadata:\n {2}version: "1\.0\.0"\n {2}author: FontAlternatives$/m);
	const desc = fm.match(/^description: (.*)$/m)[1];
	assert.ok(desc.length <= 1024);
	assert.ok(desc.startsWith("Audit the web fonts a project declares and uses, from its source files."));
	assert.ok(desc.endsWith("which is sent font family names only."));
	assert.ok(!/^(allowed-tools|homepage):/m.test(fm));
});

test("skill-version.txt equals frontmatter metadata.version", () => {
	const file = fs.readFileSync(path.join(SKILL_DIR, "skill-version.txt"), "utf8");
	assert.match(file, /^\d+\.\d+\.\d+\n?$/);
	const fmVersion = frontmatter().match(/^ {2}version: "([^"]+)"$/m)[1];
	assert.equal(file.trim(), fmVersion);
	assert.equal(fmVersion, "1.0.0");
});

test("SKILL.md rule sentence equals FONT_DISPLAY_RULE, and the reason equals FONT_DISPLAY_REASON", () => {
	const ruleLines = lines.filter((l) => l.startsWith("Rule: "));
	assert.deepEqual(ruleLines, [FONT_DISPLAY_RULE]);
	const at = lines.findIndex((l) => l.startsWith("Reason: "));
	const reason = [];
	for (let i = at; i < lines.length && lines[i].trim() !== ""; i++) reason.push(lines[i]);
	assert.equal(reason.join(" "), FONT_DISPLAY_REASON);
	assert.match(skillMd, /^## 3\. Font-display rule \(v1\)$/m);
});

test("MCP-absent text is DESIGN 2.6 exactly", () => {
	assert.equal(fencedAfter(skillMd, "## Without the MCP"), MCP_ABSENT);
});

test("report-template.md ends with the DESIGN 2.7 block exactly", () => {
	const t = fs.readFileSync(path.join(SKILL_DIR, "references/report-template.md"), "utf8");
	assert.ok(t.trimEnd().endsWith(`\`\`\`\n${REPORT_ENDING}\n\`\`\``), "fixed ending is the last thing in the file");
	assert.ok(t.split("\n").length <= 80);
});

test("reference files exist and stay within budget", () => {
	const budget = { "scan-details.md": 200, "report-template.md": 80, "licence-notes.md": 80 };
	const present = fs.readdirSync(path.join(SKILL_DIR, "references")).sort();
	assert.deepEqual(present, Object.keys(budget).sort());
	for (const [f, max] of Object.entries(budget)) {
		const n = fs.readFileSync(path.join(SKILL_DIR, "references", f), "utf8").replace(/\n$/, "").split("\n").length;
		assert.ok(n <= max, `${f}: ${n} lines`);
	}
});

test("Google and DevTools links are pinned; typography and the blocked draft are not linked", () => {
	const urls = allSkillText.flatMap(([, t]) => t.match(/https?:\/\/[^\s)|`>"]+/g) || []);
	const mwg = urls.filter((u) => u.includes("modern-web-guidance"));
	assert.ok(mwg.length >= 5, "the five guide links");
	for (const u of mwg) assert.ok(u.includes("/blob/v1.0.0/"), u);
	for (const id of ["visually-stable-font-fallbacks", "optimize-preload-priority", "performance/performance.md", "secure-external-subresources", "visually-stable-mixed-fonts"])
		assert.ok(mwg.some((u) => u.includes(id)), id);
	const devtools = urls.filter((u) => u.includes("chrome-devtools-mcp"));
	assert.ok(devtools.length >= 1);
	for (const u of devtools) assert.ok(u.includes("/blob/chrome-devtools-mcp-v1.13.0/skills/debug-optimize-lcp/"), u);
	assert.ok(!urls.some((u) => /typography/i.test(u)), "typography guide is not linked");
	const blocked = ["share", "web", "fonts", "across", "origins"].join("-");
	for (const [f, t] of allSkillText) assert.ok(!t.includes(blocked), `${f} mentions the blocked draft`);
});

test("the skill never links the unpublished install page", () => {
	const page = ["/tools/", "webfont-audit"].join("");
	for (const [f, t] of allSkillText) assert.ok(!t.includes(page), f);
	for (const f of ["README.md", "docs/install.md"]) assert.ok(!fs.readFileSync(path.join(SKILL_DIR, "../..", f), "utf8").includes(page), f);
});

test("scan-fonts.mjs imports no network or process module and uses no dynamic code", () => {
	const src = fs.readFileSync(SCRIPT, "utf8");
	const specifiers = [...src.matchAll(/^\s*import\s+(?:[^"';]+\s+from\s+)?["']([^"']+)["']/gm)].map((m) => m[1]);
	assert.deepEqual([...new Set(specifiers)].sort(), ["node:fs", "node:path", "node:url"]);
	const banned = [
		/\brequire\s*\(/,
		/\bimport\s*\(/,
		/\bcreateRequire\b/,
		/\bfetch\b/,
		/XMLHttpRequest/,
		/WebSocket/,
		/EventSource/,
		/navigator\.sendBeacon/,
		/process\.binding/,
		/process\.dlopen/,
		/\beval\s*\(/,
		/new\s+Function\b/,
		/["'](?:node:)?(?:http|https|http2|net|tls|dgram|dns|child_process|worker_threads|cluster|inspector|vm)["']/,
	];
	for (const re of banned) assert.ok(!re.test(src), `scan-fonts.mjs matches ${re}`);
	assert.ok(!/\bimport\s+[^;]*\bfrom\s+["'](?!node:(fs|path|url)["'])/.test(src));
});
