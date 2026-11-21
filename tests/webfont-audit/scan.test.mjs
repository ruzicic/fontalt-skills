// Scanner behaviour: fixtures, catalogue mapping, limits, skips. Run: node --test tests/webfont-audit/
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { CASES, FIXTURES, SCRIPT, SKILL_DIR } from "./helpers.mjs";
import {
	FONT_DISPLAY_REASON,
	FONT_DISPLAY_RULE,
	ICON_REASON,
	MAX_FILES,
	MAX_FILE_BYTES,
	SCHEMA,
	catalogueFindings,
	familiesForCatalogue,
	scan,
} from "../../skills/webfont-audit/scripts/scan-fonts.mjs";

const readJson = (p) => JSON.parse(fs.readFileSync(p, "utf8"));
const ids = (findings) => findings.map((f) => f.id);
const skillVersion = fs.readFileSync(path.join(SKILL_DIR, "skill-version.txt"), "utf8").trim();

function tmpDir(name) {
	return fs.mkdtempSync(path.join(os.tmpdir(), `webfont-audit-${name}-`));
}

for (const c of CASES) {
	test(`fixture ${c} matches expected-findings.json`, () => {
		const result = scan(path.join(FIXTURES, c));
		const expected = readJson(path.join(FIXTURES, c, "expected-findings.json"));
		assert.deepEqual(result.findings, expected.findings);
	});
}

test("every fixture case exists with an expected findings file", () => {
	for (const c of CASES) assert.ok(fs.existsSync(path.join(FIXTURES, c, "expected-findings.json")), c);
});

test("scan output follows webfont-audit.scan/v1 and is deterministic", () => {
	for (const c of CASES) {
		const a = scan(path.join(FIXTURES, c));
		const b = scan(path.join(FIXTURES, c));
		assert.deepEqual(a, b, c);
		assert.equal(a.schema, SCHEMA);
		assert.equal(a.skill_version, skillVersion);
		for (const f of a.families) {
			for (const k of ["family", "weights_declared", "weights_used", "italic_used", "axes_used", "font_display", "load_methods", "locations"])
				assert.ok(k in f, `${c}: ${k}`);
			for (const loc of f.locations) {
				assert.ok(!path.isAbsolute(loc.file) && !loc.file.includes("\\") && !loc.file.startsWith(".."), loc.file);
				assert.ok(Number.isInteger(loc.line) && loc.line > 0);
			}
		}
		for (const f of a.findings) assert.deepEqual(Object.keys(f).sort(), ["detail", "family", "file", "id", "line"]);
	}
});

test("css-fontface covers the DESIGN 4.1 font-display cases", () => {
	const r = scan(path.join(FIXTURES, "css-fontface"));
	const byFamily = (fam) => r.findings.filter((f) => f.family === fam).map((f) => f.id);
	assert.deepEqual(byFamily("Source Serif"), ["missing-font-display", "missing-font-display"]); // missing + auto
	assert.deepEqual(byFamily("Brand Display"), ["font-display-block"]); // block on a text family
	assert.deepEqual(byFamily("Acme Icons"), []); // block on an icon family
	assert.deepEqual(byFamily("Docs Symbols"), ["missing-font-display"]); // icon, missing: fix is block
	assert.match(r.findings.find((f) => f.family === "Docs Symbols").detail, /font-display: block;/);
	assert.deepEqual(byFamily("Source Serif Fallback"), []); // local()-only face
	assert.deepEqual(byFamily("Body Sans"), []); // swap, plus a var() value that is not checked
	assert.deepEqual(byFamily("Code Mono"), ["unused-face-weight"]); // optional + fallback pass
	const auto = r.findings.find((f) => f.family === "Source Serif" && f.detail.startsWith("font-display: auto"));
	assert.ok(auto, "auto case present");
	const fam = Object.fromEntries(r.families.map((f) => [f.family, f]));
	assert.deepEqual(fam["Source Serif"].font_display, ["auto", "missing"]);
	assert.equal(fam["Source Serif Fallback"].font_display, null);
	assert.deepEqual(fam["Body Sans"].font_display, ["swap", "unknown"]);
});

test("google-link covers a URL with and without display=", () => {
	const r = scan(path.join(FIXTURES, "google-link"));
	const display = r.findings.filter((f) => f.id === "missing-font-display");
	assert.deepEqual(display.map((f) => `${f.file}:${f.line}`), ["about.html:7", "styles.css:2"]);
	assert.ok(display.every((f) => f.family === null));
	assert.match(display[0].detail, /^This Google Fonts URL \(Lora, Inter\) has no display parameter/);
	// index.html sets display=swap (no display finding) but is render-blocking; the icon URL uses display=block
	assert.ok(!r.findings.some((f) => f.file === "index.html" && f.id.includes("display")));
	assert.deepEqual(ids(r.findings.filter((f) => f.file === "index.html")), ["render-blocking-google-css", "unused-face-weight"]);
});

test("next-font covers the default display and display: \"block\"", () => {
	const r = scan(path.join(FIXTURES, "next-font"));
	const fam = Object.fromEntries(r.families.map((f) => [f.family, f]));
	assert.equal(fam.Inter.font_display, "swap");
	assert.ok(!r.findings.some((f) => f.family === "Inter"));
	const block = r.findings.filter((f) => f.id === "font-display-block");
	assert.deepEqual(block.map((f) => f.family), ["Roboto Mono"]);
	assert.ok(block[0].detail.startsWith('next/font loads "Roboto Mono" with display: "block"'));
	assert.equal(r.findings.filter((f) => f.id === "nextfont-subset-mismatch").length, 2);
});

test("every font-display finding carries the Rule and one Reason constant, in DESIGN order", () => {
	let count = 0;
	for (const c of CASES) {
		for (const f of scan(path.join(FIXTURES, c)).findings) {
			if (f.id === "render-blocking-google-css") assert.ok(!/font-display/.test(f.detail), "render-blocking copy must not mention font-display");
			if (f.id !== "missing-font-display" && f.id !== "font-display-block") continue;
			count++;
			assert.ok(f.detail.includes(` ${FONT_DISPLAY_RULE} `), f.detail);
			const reason = f.detail.includes(FONT_DISPLAY_REASON) ? FONT_DISPLAY_REASON : f.detail.includes(ICON_REASON) ? ICON_REASON : null;
			assert.ok(reason, f.detail);
			const [obs, rest] = f.detail.split(` ${FONT_DISPLAY_RULE} `);
			assert.ok(obs.length > 0 && rest.startsWith(`${reason} Fix: `), f.detail);
		}
	}
	assert.equal(count, 7, "font-display findings across the fixtures");
});

test("the DESIGN 1.6 example detail is emitted exactly", () => {
	const dir = tmpDir("example");
	fs.writeFileSync(path.join(dir, "a.css"), '@font-face {\n  font-family: "Inter";\n  src: url("inter.woff2") format("woff2");\n}\n');
	const [f] = scan(dir).findings;
	fs.rmSync(dir, { recursive: true, force: true });
	assert.equal(
		f.detail,
		'No font-display on this @font-face for "Inter": the browser default (auto) can hide the text for up to about 3 seconds while the font downloads. Rule: set font-display on every web font: swap by default, fallback or optional by choice, block only for icon fonts. Reason: hidden text delays first paint and LCP; fix the shift from a late swap with a metric-matched fallback, not by hiding text. Fix: add "font-display: swap;" to this rule.',
	);
});

// ---- catalogue findings against frozen resolve_fonts responses (SPEC 7.2 shape)

const CATALOGUE_CASES = ["google-link", "itf-selfhost", "unknown-commercial"];

for (const c of CATALOGUE_CASES) {
	test(`catalogue findings for ${c} match the frozen resolve_fonts response`, () => {
		const dir = path.join(FIXTURES, c);
		const s = scan(dir);
		const res = readJson(path.join(dir, "resolve-fonts.json"));
		for (const k of ["status", "disclaimer", "source", "data_updated_at", "source_commit", "catalogue_version", "results"]) assert.ok(k in res, k);
		assert.equal(res.source, "FontAlternatives catalogue");
		for (const item of res.results) {
			assert.ok(["found", "ambiguous", "generic", "not_in_catalogue"].includes(item.status));
			if (item.font)
				assert.deepEqual(Object.keys(item.font).sort(), ["italics", "kind", "license_id", "name", "page_url", "slug", "variable_axes", "variable_font", "weights"]);
		}
		assert.deepEqual(catalogueFindings(s, res), readJson(path.join(dir, "expected-catalogue-findings.json")).findings);
		const lookup = path.join(dir, "lookup-license.json");
		if (fs.existsSync(lookup)) {
			assert.deepEqual(
				catalogueFindings(s, res, readJson(lookup)),
				readJson(path.join(dir, "expected-catalogue-findings-with-lookup.json")).findings,
			);
		}
	});
}

test("the five catalogue finding ids all appear, with the required wording", () => {
	const all = [];
	for (const c of CATALOGUE_CASES) {
		const dir = path.join(FIXTURES, c);
		all.push(...catalogueFindings(scan(dir), readJson(path.join(dir, "resolve-fonts.json"))));
	}
	for (const id of ["weight-not-available", "italic-not-available", "axis-not-available", "licence-flags", "not-in-catalogue"])
		assert.ok(all.some((f) => f.id === id), id);
	for (const f of all.filter((x) => x.id === "weight-not-available"))
		assert.ok(f.detail.includes("the browser will substitute the nearest weight or synthesize it"), f.detail);
	for (const f of all) assert.ok(!/\b(compliant|in breach|violat)/i.test(f.detail), f.detail);
});

test("ITF FFL with font files in the repo names the no-modify/subset/convert/redistribute flags", () => {
	const dir = path.join(FIXTURES, "itf-selfhost");
	const res = readJson(path.join(dir, "resolve-fonts.json"));
	for (const lic of [{}, readJson(path.join(dir, "lookup-license.json"))]) {
		const flags = catalogueFindings(scan(dir), res, lic).filter((f) => f.id === "licence-flags");
		assert.equal(flags.length, 2);
		for (const f of flags) {
			assert.match(f.detail, /no modifying, subsetting or converting the font files and no redistributing them/);
			assert.ok(f.detail.endsWith("Official licence: https://www.fontshare.com/licenses/itf-ffl"));
		}
	}
});

test('"unknown" catalogue fields are never reported as a mismatch', () => {
	const dir = path.join(FIXTURES, "itf-selfhost");
	const found = catalogueFindings(scan(dir), readJson(path.join(dir, "resolve-fonts.json")));
	// Cabinet Grotesk is free_listed: weights, italics and axes are "unknown"
	assert.deepEqual(found.filter((f) => f.family === "Cabinet Grotesk").map((f) => f.id), ["licence-flags"]);
	// Satoshi has a wght axis 300..900: 200 is missing, 400 (declared) is not
	assert.deepEqual(found.filter((f) => f.id === "weight-not-available").map((f) => f.detail.match(/weight (\d+),/)[1]), ["200"]);
	// Acme Corp Sans is not in the catalogue: "not in our data", not a problem
	const unknown = catalogueFindings(scan(path.join(FIXTURES, "unknown-commercial")), readJson(path.join(FIXTURES, "unknown-commercial/resolve-fonts.json")));
	const acme = unknown.find((f) => f.family === "Acme Corp Sans");
	assert.equal(acme.id, "not-in-catalogue");
	assert.match(acme.detail, /not in our data/);
	assert.ok(unknown.find((f) => f.family === "Helvetica Neue").detail.includes("holds no licence terms"));
});

test("familiesForCatalogue drops generics and local()-only faces and batches by 25", () => {
	const r = scan(path.join(FIXTURES, "css-fontface"));
	const { names, batches } = familiesForCatalogue(r);
	assert.ok(!names.includes("Source Serif Fallback"));
	assert.ok(names.includes("Source Serif"));
	assert.ok(batches.every((b) => b.length <= 25));
	const many = { families: Array.from({ length: 30 }, (_, i) => ({ family: `F${i}`, load_methods: ["font-face"] })) };
	assert.deepEqual(familiesForCatalogue(many).batches.map((b) => b.length), [25, 5]);
});

// ---- limits and skips

test(`stops at ${MAX_FILES} files and says so`, () => {
	const dir = tmpDir("limit");
	for (let i = 0; i < MAX_FILES + 10; i++) fs.writeFileSync(path.join(dir, `f${String(i).padStart(5, "0")}.css`), "a{color:red}\n");
	const r = scan(dir);
	assert.equal(r.stats.files_scanned, MAX_FILES);
	assert.equal(r.stats.file_limit, MAX_FILES);
	assert.equal(r.stats.file_limit_reached, true);
	const text = execFileSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" });
	assert.match(text, /Stopped at the 5000-file limit/);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("skips files over 1 MB and lists them", () => {
	const dir = tmpDir("big");
	const face = '@font-face { font-family: "Big"; src: url("big.woff2"); }\n';
	fs.writeFileSync(path.join(dir, "big.css"), face + "/*" + "x".repeat(MAX_FILE_BYTES) + "*/\n");
	const edge = face.replace("Big", "Edge");
	fs.writeFileSync(path.join(dir, "edge.css"), edge + " ".repeat(MAX_FILE_BYTES - edge.length));
	const r = scan(dir);
	assert.equal(fs.statSync(path.join(dir, "edge.css")).size, MAX_FILE_BYTES);
	assert.equal(r.stats.files_skipped_too_large, 1);
	assert.deepEqual(r.stats.skipped_too_large, ["big.css"]);
	assert.deepEqual(r.findings.map((f) => f.family), ["Edge"]);
	assert.equal(r.stats.file_limit_reached, false);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("skips node_modules, .git, build output, .env* and symlinks that leave the root", () => {
	const dir = tmpDir("skip");
	const outside = tmpDir("outside");
	const face = (n) => `@font-face { font-family: "${n}"; src: url("x.woff2"); }\n`;
	for (const d of ["node_modules/pkg", ".git", "dist", "build", ".next", "out"]) {
		fs.mkdirSync(path.join(dir, d), { recursive: true });
		fs.writeFileSync(path.join(dir, d, "fonts.css"), face(`Skipped ${d}`));
	}
	fs.writeFileSync(path.join(dir, ".env.css"), face("Env"));
	fs.writeFileSync(path.join(outside, "evil.css"), face("Outside"));
	fs.symlinkSync(path.join(outside, "evil.css"), path.join(dir, "link.css"));
	fs.symlinkSync(outside, path.join(dir, "linkdir"));
	fs.writeFileSync(path.join(dir, "real.css"), face("Real"));
	fs.symlinkSync(path.join(dir, "real.css"), path.join(dir, "inside-link.css"));
	const r = scan(dir);
	assert.deepEqual(r.families.map((f) => f.family), ["Real"]);
	assert.equal(r.stats.symlinks_skipped, 2);
	assert.equal(r.stats.files_scanned, 2); // real.css and the in-root link to it
	fs.rmSync(dir, { recursive: true, force: true });
	fs.rmSync(outside, { recursive: true, force: true });
});

test("skips tests, fixtures, docs prototypes and caches by default; --all scans them", () => {
	const dir = tmpDir("nonship");
	const face = (n) => `@font-face { font-family: "${n}"; src: url("x.woff2"); }\n`;
	const put = (rel, body) => {
		fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
		fs.writeFileSync(path.join(dir, rel), body);
	};
	put("src/app.css", face("App"));
	put("tests/a.css", face("InTests"));
	put("src/__tests__/b.css", face("InUnderTests"));
	put("fixtures/site/c.css", face("InFixtures"));
	put("docs/board.html", `<style>${face("InDocs")}</style>`);
	put(".wrangler/tmp/index.js", `const css = '${face("InCache").trim()}';`);
	put("src/fonts.test.ts", `const css = '${face("InTestFile").trim()}';`);
	put("src/Button.stories.tsx", `const css = '${face("InStory").trim()}';`);
	put("site/docs/.vitepress/x.css", face("Nested"));
	const r = scan(dir);
	// site/docs has a .vitepress folder, so it is a docs site and stays in the scan.
	assert.deepEqual(r.families.map((f) => f.family), ["App", "Nested"]);
	assert.deepEqual(r.stats.non_shipping_skipped, [".wrangler", "docs", "fixtures", "src/__tests__", "tests"]);
	assert.equal(r.stats.files_skipped_non_shipping, 2);
	const all = scan(dir, { all: true });
	assert.equal(all.families.length, 9);
	assert.deepEqual(all.stats.non_shipping_skipped, []);
	assert.equal(all.stats.files_skipped_non_shipping, 0);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a Google Fonts URL with no family (built at run time) gets no empty family list", () => {
	const dir = tmpDir("nofamily");
	fs.writeFileSync(path.join(dir, "index.html"), '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?display=swap">\n');
	const r = scan(dir);
	assert.deepEqual(ids(r.findings), ["render-blocking-google-css"]);
	for (const f of r.findings) assert.ok(!f.detail.includes("()"), f.detail);
	fs.rmSync(dir, { recursive: true, force: true });
});

test("a docs/ folder that is its own site is scanned", () => {
	for (const marker of ["package.json", ".vitepress"]) {
		const dir = tmpDir(`docsite-${marker}`);
		fs.mkdirSync(path.join(dir, "docs", marker === ".vitepress" ? ".vitepress" : ""), { recursive: true });
		if (marker === "package.json") fs.writeFileSync(path.join(dir, "docs", "package.json"), "{}");
		fs.writeFileSync(path.join(dir, "docs", "site.css"), '@font-face { font-family: "DocsSite"; src: url("x.woff2"); }\n');
		const r = scan(dir);
		assert.deepEqual(r.families.map((f) => f.family), ["DocsSite"], marker);
		assert.deepEqual(r.stats.non_shipping_skipped, [], marker);
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

test("CLI: --json and plain output, first line carries the skill version", () => {
	const dir = path.join(FIXTURES, "css-fontface");
	const json = JSON.parse(execFileSync(process.execPath, [SCRIPT, dir, "--json"], { encoding: "utf8" }));
	assert.equal(json.schema, SCHEMA);
	assert.equal(json.skill_version, skillVersion);
	assert.deepEqual(json, JSON.parse(JSON.stringify(scan(dir))));
	const first = execFileSync(process.execPath, [SCRIPT, dir], { encoding: "utf8" }).split("\n")[0];
	assert.ok(first.startsWith(`Webfont Audit ${skillVersion} · scan ${SCHEMA}`), first);
});

test('skill_version is "unknown" when skill-version.txt is missing', () => {
	const dir = tmpDir("noversion");
	fs.mkdirSync(path.join(dir, "scripts"));
	fs.copyFileSync(SCRIPT, path.join(dir, "scripts/scan-fonts.mjs"));
	const out = JSON.parse(execFileSync(process.execPath, [path.join(dir, "scripts/scan-fonts.mjs"), path.join(FIXTURES, "fontsource"), "--json"], { encoding: "utf8" }));
	assert.equal(out.skill_version, "unknown");
	fs.rmSync(dir, { recursive: true, force: true });
});

test("importing the module does not run the CLI", () => {
	const out = execFileSync(process.execPath, ["--input-type=module", "-e", `import(${JSON.stringify(SCRIPT)}).then(() => {})`], { encoding: "utf8" });
	assert.equal(out, "");
});
