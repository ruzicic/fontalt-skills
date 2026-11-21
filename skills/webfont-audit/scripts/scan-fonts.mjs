#!/usr/bin/env node
// Webfont Audit scanner. Usage: node scan-fonts.mjs <dir> [--json] [--all]
//
// Reads the source files of a project and writes a report to stdout. It never opens a
// network connection, never runs another program and never parses font binaries: font
// files are only listed by name. Node.js 18+, built-in modules only (fs, path, url).
// Field meanings and every finding id: ../references/scan-details.md

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const SCHEMA = "webfont-audit.scan/v1";
export const MAX_FILES = 5000;
export const MAX_FILE_BYTES = 1024 * 1024;

export const FONT_DISPLAY_RULE =
	"Rule: set font-display on every web font: swap by default, fallback or optional by choice, block only for icon fonts.";
export const FONT_DISPLAY_REASON =
	"Reason: hidden text delays first paint and LCP; fix the shift from a late swap with a metric-matched fallback, not by hiding text.";
export const ICON_REASON =
	"Reason: an icon font's fallback is not readable text, so swap would put ligature names or empty boxes on screen until the icons load; block hides them briefly instead.";

// A family is an icon family when its name contains one of these (case-insensitive).
export const ICON_FAMILY_MARKERS = [
	"icon",
	"symbols",
	"awesome",
	"icomoon",
	"fontello",
	"codicon",
	"feather",
	"lucide",
	"phosphor",
	"tabler",
];

export const LICENCE_GUIDE_URL = "https://fontalternatives.com/licenses/?utm_source=webfont-audit&utm_medium=skill";

export const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".next", "out"]);
// Folders whose CSS and HTML do not ship with the site, skipped by default (listed in stats.non_shipping_skipped) so
// test strings and design mock-ups do not bury the real findings; --all scans them too. Names compare
// case-insensitively. These are skipped at any depth:
export const NON_SHIPPING_DIRS_ANYWHERE = new Set([
	"__tests__",
	"__mocks__",
	"fixtures",
	"__fixtures__",
	"cypress",
	"playwright-report",
	"test-results",
	"coverage",
	".storybook",
	"storybook-static",
	".wrangler",
	".astro",
	".svelte-kit",
	".nuxt",
	".output",
	".vercel",
	".netlify",
	".turbo",
	".cache",
]);
// These only at the scan root or a workspace root (apps/<name>, packages/<name>): deeper down they are usually
// routes or components (app/docs, src/routes/docs, src/pages/examples) and ship.
export const NON_SHIPPING_DIRS_TOP = new Set(["test", "tests", "e2e", "examples", "docs"]);
// A docs/ folder that a site generator publishes is kept: its own markers, or mkdocs.yml next to it.
const DOCS_SITE_MARKERS = [
	"package.json",
	".vitepress",
	"_config.yml",
	"index.html",
	"index.md",
	"conf.py",
	"mint.json",
	"docs.json",
	"docusaurus.config.js",
	"docusaurus.config.ts",
	"docusaurus.config.mjs",
];
const DOCS_SITE_SIBLINGS = ["mkdocs.yml", "mkdocs.yaml"];
// Test, spec, story and Cypress files (any extension): their font URLs and @font-face strings are test data.
export const NON_SHIPPING_FILE = /\.(test|spec|stories|story|cy)\.[a-z0-9]+$/i;
// At most this many skipped folders are listed; the rest are counted in stats.non_shipping_skipped_more.
export const NON_SHIPPING_LIST_MAX = 20;
const CSS_EXT = new Set([".css", ".scss", ".less"]);
const MARKUP_EXT = new Set([".html", ".htm", ".vue", ".svelte", ".astro"]);
const SCRIPT_EXT = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const FONT_EXT = new Set([".woff2", ".woff", ".ttf", ".otf", ".eot"]);

const GENERIC_FAMILIES = new Set([
	"serif",
	"sans-serif",
	"monospace",
	"cursive",
	"fantasy",
	"system-ui",
	"ui-serif",
	"ui-sans-serif",
	"ui-monospace",
	"ui-rounded",
	"emoji",
	"math",
	"fangsong",
	"-apple-system",
	"blinkmacsystemfont",
	"inherit",
	"initial",
	"unset",
	"revert",
	"revert-layer",
	"default",
]);

// Hosts that serve font CSS. Any other external stylesheet counts only if its path mentions "font".
const FONT_CSS_HOSTS = new Set([
	"fonts.googleapis.com",
	"use.typekit.net",
	"p.typekit.net",
	"fonts.bunny.net",
	"api.fontshare.com",
	"fonts.cdnfonts.com",
	"fast.fonts.net",
	"cloud.typography.com",
]);
// Hosts that belong to one provider are reported as one origin.
const ORIGIN_GROUPS = { "fonts.gstatic.com": "fonts.googleapis.com", "p.typekit.net": "use.typekit.net" };
const SELF_ORIGIN = "self-hosted (this project)";

const TAILWIND_WEIGHTS = {
	thin: 100,
	extralight: 200,
	light: 300,
	normal: 400,
	medium: 500,
	semibold: 600,
	bold: 700,
	extrabold: 800,
	black: 900,
};

const DISPLAY_KEYWORDS = new Set(["swap", "fallback", "optional", "block", "auto"]);

// ---------------------------------------------------------------------------------------------
// Small helpers

function readSkillVersion() {
	try {
		const file = fileURLToPath(new URL("../skill-version.txt", import.meta.url));
		const v = fs.readFileSync(file, "utf8").trim();
		return v || "unknown";
	} catch {
		return "unknown";
	}
}

export const SKILL_VERSION = readSkillVersion();

function toPosix(p) {
	return p.split(path.sep).join("/");
}

function cmp(a, b) {
	return a < b ? -1 : a > b ? 1 : 0;
}

export function isIconFamily(name) {
	const n = String(name).toLowerCase();
	return ICON_FAMILY_MARKERS.some((m) => n.includes(m));
}

function cleanName(raw) {
	let s = String(raw).replace(/!important/gi, "").trim();
	s = s.replace(/^["'`]+|["'`]+$/g, "").trim();
	return s.replace(/\s+/g, " ");
}

function isUsableName(name) {
	if (!name) return false;
	if (/[$@{}()#\\]|^var\b|^--/.test(name)) return false;
	if (/^[\d.]/.test(name)) return false;
	return true;
}

export function isGeneric(name) {
	return GENERIC_FAMILIES.has(String(name).toLowerCase());
}

function familyKey(name) {
	return cleanName(name).toLowerCase();
}

function parseStack(value) {
	const out = [];
	let cur = "";
	let quote = null;
	for (const ch of String(value)) {
		if (quote) {
			if (ch === quote) quote = null;
			cur += ch;
		} else if (ch === '"' || ch === "'") {
			quote = ch;
			cur += ch;
		} else if (ch === ",") {
			out.push(cur);
			cur = "";
		} else cur += ch;
	}
	out.push(cur);
	return out.map(cleanName).filter(isUsableName);
}

function parseWeightToken(tok) {
	const t = String(tok).trim().toLowerCase().replace(/!important/, "").trim();
	if (t === "normal" || t === "regular") return { weight: 400 };
	if (t === "bold") return { weight: 700 };
	if (t === "bolder" || t === "lighter") return { relative: true };
	if (/^\d+(\.\d+)?$/.test(t)) {
		const n = Math.round(Number(t));
		if (n >= 1 && n <= 1000) return { weight: n };
	}
	if (/var\(|^\$|^@|#\{/.test(t)) return { unresolved: true };
	return {};
}

function lineIndex(text) {
	const starts = [0];
	for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) starts.push(i + 1);
	return (offset) => {
		let lo = 0;
		let hi = starts.length - 1;
		while (lo < hi) {
			const mid = (lo + hi + 1) >> 1;
			if (starts[mid] <= offset) lo = mid;
			else hi = mid - 1;
		}
		return lo + 1;
	};
}

// Replace comments with spaces but keep newlines, so offsets and line numbers stay correct.
function blank(s) {
	return s.replace(/[^\n]/g, " ");
}

function stripComments(text, kind, ext) {
	let t = text.replace(/\/\*[\s\S]*?\*\//g, blank);
	if (kind === "markup") t = t.replace(/<!--[\s\S]*?-->/g, blank);
	if (ext === ".scss" || ext === ".less" || kind === "script")
		t = t.replace(/(^|[^:"'`(\\/])(\/\/[^\n]*)/gm, (m, pre, c) => pre + blank(c));
	return t;
}

// A value read from an HTML style="" attribute can carry the closing quote; drop an unbalanced one.
function trimValue(v) {
	let out = v.trim();
	for (const q of ['"', "'"]) {
		if ((out.split(q).length - 1) % 2 === 1) out = out.slice(0, out.lastIndexOf(q)).trim();
	}
	return out;
}

function matchingClose(text, openIdx, open, close) {
	let depth = 0;
	for (let i = openIdx; i < text.length; i++) {
		if (text[i] === open) depth++;
		else if (text[i] === close) {
			depth--;
			if (depth === 0) return i;
		}
	}
	return text.length;
}

function quotedStrings(s) {
	return [...String(s).matchAll(/(["'`])((?:(?!\1).)*)\1/g)].map((m) => m[2]);
}

function titleCaseSlug(slug) {
	return slug
		.split("-")
		.filter(Boolean)
		.map((w) => w[0].toUpperCase() + w.slice(1))
		.join(" ");
}

// Fontsource registers "<Name>" for static packages and "<Name> Variable" for @fontsource-variable/*.
function fontsourceFamily(slug, variable) {
	return variable ? `${titleCaseSlug(slug)} Variable` : titleCaseSlug(slug);
}

const LOCAL_FILE_NOISE = new Set([
	"variable",
	"vf",
	"var",
	"regular",
	"italic",
	"normal",
	"bold",
	"light",
	"medium",
	"semibold",
	"thin",
	"black",
	"extrabold",
	"extralight",
	"latin",
	"ext",
	"wght",
	"ital",
	"subset",
]);

function familyFromFontPath(p) {
	const stem = path.posix.basename(String(p)).replace(/\.[a-z0-9]+$/i, "");
	const words = stem
		.replace(/\[[^\]]*\]/g, " ")
		.split(/[-_\s]+/)
		.filter((w) => w && !LOCAL_FILE_NOISE.has(w.toLowerCase()) && !/^\d+$/.test(w));
	return words.join(" ") || stem;
}

// ---------------------------------------------------------------------------------------------
// File walk

function isDocsSite(absDir) {
	return (
		DOCS_SITE_MARKERS.some((m) => fs.existsSync(path.join(absDir, m))) ||
		DOCS_SITE_SIBLINGS.some((m) => fs.existsSync(path.join(path.dirname(absDir), m)))
	);
}

// A folder is at a "top" position when its parent is the scan root or a workspace package (apps/x, packages/x).
const isTopLevel = (relDir) => relDir === "" || /^(apps|packages)\/[^/]+$/i.test(relDir);

function isNonShippingDir(name, relDir, abs) {
	const n = name.toLowerCase();
	if (NON_SHIPPING_DIRS_ANYWHERE.has(n)) return true;
	if (!NON_SHIPPING_DIRS_TOP.has(n) || !isTopLevel(relDir)) return false;
	return !(n === "docs" && isDocsSite(abs));
}

function walk(root, { all = false } = {}) {
	const realRoot = fs.realpathSync(root);
	const files = [];
	const fontFiles = [];
	const stats = {
		files_scanned: 0,
		file_limit: MAX_FILES,
		file_limit_reached: false,
		max_file_bytes: MAX_FILE_BYTES,
		files_skipped_too_large: 0,
		skipped_too_large: [],
		symlinks_skipped: 0,
		font_files_found: 0,
		non_shipping_skipped: [],
		non_shipping_skipped_more: 0,
		files_skipped_non_shipping: 0,
	};
	let stop = false;

	const inside = (real) => real === realRoot || real.startsWith(realRoot + path.sep);

	function visit(relDir) {
		if (stop) return;
		let entries;
		try {
			entries = fs.readdirSync(path.join(root, relDir), { withFileTypes: true });
		} catch {
			return;
		}
		entries.sort((a, b) => cmp(a.name, b.name));
		for (const ent of entries) {
			if (stop) return;
			const name = ent.name;
			const rel = relDir ? `${relDir}/${name}` : name;
			const abs = path.join(root, rel);
			if (name.startsWith(".env")) continue;
			let isDir = ent.isDirectory();
			let isFile = ent.isFile();
			if (ent.isSymbolicLink()) {
				let real;
				try {
					real = fs.realpathSync(abs);
				} catch {
					stats.symlinks_skipped++;
					continue;
				}
				if (!inside(real)) {
					stats.symlinks_skipped++;
					continue;
				}
				let st;
				try {
					st = fs.statSync(real);
				} catch {
					continue;
				}
				if (st.isDirectory()) {
					// Symlinked directories are not followed (no loops, no double counting).
					stats.symlinks_skipped++;
					continue;
				}
				isDir = false;
				isFile = st.isFile();
			}
			if (isDir) {
				if (SKIP_DIRS.has(name)) continue;
				if (!all && isNonShippingDir(name, relDir, abs)) {
					stats.non_shipping_skipped.push(rel);
					continue;
				}
				visit(rel);
				continue;
			}
			if (!isFile) continue;
			const ext = path.extname(name).toLowerCase();
			if (FONT_EXT.has(ext)) {
				fontFiles.push(rel);
				continue;
			}
			const readable =
				CSS_EXT.has(ext) || MARKUP_EXT.has(ext) || SCRIPT_EXT.has(ext) || name === "package.json";
			if (!readable) continue;
			if (!all && NON_SHIPPING_FILE.test(name)) {
				stats.files_skipped_non_shipping++;
				continue;
			}
			if (files.length >= MAX_FILES) {
				stats.file_limit_reached = true;
				stop = true;
				return;
			}
			let size;
			try {
				size = fs.statSync(abs).size;
			} catch {
				continue;
			}
			if (size > MAX_FILE_BYTES) {
				stats.files_skipped_too_large++;
				stats.skipped_too_large.push(rel);
				continue;
			}
			files.push(rel);
		}
	}

	visit("");
	stats.non_shipping_skipped.sort(cmp);
	stats.non_shipping_skipped_more = Math.max(0, stats.non_shipping_skipped.length - NON_SHIPPING_LIST_MAX);
	stats.non_shipping_skipped = stats.non_shipping_skipped.slice(0, NON_SHIPPING_LIST_MAX);
	stats.files_scanned = files.length;
	stats.font_files_found = fontFiles.length;
	return { files, fontFiles, stats };
}

// ---------------------------------------------------------------------------------------------
// The scan

function createState() {
	return {
		families: new Map(),
		usages: [],
		faces: [],
		googleUrls: [],
		nextCalls: [],
		declaredWeights: [],
		origins: new Map(),
		unattributedWeights: new Set(),
		relativeWeightSeen: false,
		unresolvedWeightSeen: false,
		customWeightProps: 0,
		memberRefs: new Set(),
		findings: [],
	};
}

function familyEntry(state, rawName) {
	const name = cleanName(rawName);
	if (!isUsableName(name) || isGeneric(name)) return null;
	const key = familyKey(name);
	let e = state.families.get(key);
	if (!e) {
		e = {
			family: name,
			weights_declared: new Set(),
			weights_used: new Set(),
			italic_used: false,
			axes_used: new Set(),
			displays: new Set(),
			load_methods: new Set(),
			font_files: new Set(),
			locations: new Map(),
			used: false,
			nextIdents: new Set(),
		};
		state.families.set(key, e);
	}
	return e;
}

function addLocation(entry, file, line) {
	entry.locations.set(`${file}\u0000${String(line).padStart(8, "0")}`, { file, line });
}

function addOrigin(state, origin, file, line) {
	const o = ORIGIN_GROUPS[origin] || origin;
	const prev = state.origins.get(o);
	if (!prev || cmp(`${file}\u0000${String(line).padStart(8, "0")}`, prev.sortKey) < 0) {
		state.origins.set(o, { file, line, sortKey: `${file}\u0000${String(line).padStart(8, "0")}` });
	}
}

function hostOf(url) {
	try {
		const u = new URL(url.startsWith("//") ? `https:${url}` : url);
		return u.hostname.toLowerCase();
	} catch {
		return null;
	}
}

function analyseFile(state, ctx) {
	const { rel, text: raw, fontFileSet } = ctx;
	const ext = path.extname(rel).toLowerCase();
	const base = path.posix.basename(rel);
	const kind = base === "package.json" ? "package" : CSS_EXT.has(ext) ? "css" : MARKUP_EXT.has(ext) ? "markup" : "script";
	const lineOf = lineIndex(raw);

	if (kind === "package") {
		analysePackageJson(state, rel, raw, lineOf);
		return;
	}
	const text = stripComments(raw, kind, ext);
	const dir = path.posix.dirname(rel) === "." ? "" : path.posix.dirname(rel);

	analyseBlocks(state, { rel, text, kind, lineOf, dir, fontFileSet });
	analyseGoogleUrls(state, { rel, text, kind, lineOf });
	analyseExternalStylesheets(state, { rel, text, kind, lineOf });
	analyseFontsource(state, { rel, text, lineOf });
	if (kind === "script" || kind === "markup") {
		analyseNextFont(state, { rel, text, lineOf, dir, fontFileSet });
		analyseMarkupWeights(state, text);
		for (const m of text.matchAll(/\b([A-Za-z_$][\w$]*)\.(className|variable|style)\b/g)) state.memberRefs.add(m[1]);
	}
	if (/^tailwind\.config\.[cm]?[jt]s$/.test(base)) analyseTailwindConfig(state, { rel, text, lineOf });
}

function analysePackageJson(state, rel, raw, lineOf) {
	for (const m of raw.matchAll(/"(@fontsource(-variable)?\/([a-z0-9-]+))"\s*:/g)) {
		const e = familyEntry(state, fontsourceFamily(m[3], Boolean(m[2])));
		if (!e) continue;
		e.load_methods.add(m[2] ? "fontsource-variable" : "fontsource");
		e.displays.add("unknown");
		addLocation(e, rel, lineOf(m.index));
		addOrigin(state, SELF_ORIGIN, rel, lineOf(m.index));
	}
}

// Split text into brace blocks. Each block keeps the ranges of its own text (nested blocks excluded).
function braceBlocks(text) {
	const root = { prelude: "", segments: [], parent: null, isRoot: true };
	const all = [root];
	let cur = root;
	let segStart = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text[i];
		if (c === "{") {
			cur.segments.push([segStart, i]);
			let j = i - 1;
			while (j >= 0 && !";{}".includes(text[j]) && i - j < 300) j--;
			const b = { prelude: text.slice(j + 1, i).trim(), open: i, segments: [], parent: cur, isRoot: false };
			all.push(b);
			cur = b;
			segStart = i + 1;
		} else if (c === "}") {
			cur.segments.push([segStart, i]);
			if (cur.parent) cur = cur.parent;
			segStart = i + 1;
		}
	}
	cur.segments.push([segStart, text.length]);
	return all;
}

const KEBAB_DECL =
	/(?<![\w-])(font-family|font-weight|font-style|font-variation-settings|font-display|src|unicode-range|font|--font-(?!weight|size|stretch|style|feature|variation|display|smoothing)[\w-]*|--[\w-]*weight[\w-]*)\s*:\s*([^;{}\n]*)/g;
const CAMEL_DECL =
	/\b(fontFamily|fontWeight|fontStyle|fontVariationSettings)\s*:\s*(?:(["'`])((?:(?!\2)[^\n])*)\2|(\d+))/g;

function blockDecls(text, block, kind) {
	const decls = [];
	for (const [s, e] of block.segments) {
		const seg = text.slice(s, e);
		for (const m of seg.matchAll(KEBAB_DECL)) {
			const prop = m[1].toLowerCase();
			if (prop === "font" && kind === "script") continue;
			if (prop === "src" && !/@font-face$/i.test(block.prelude)) continue;
			decls.push({ prop, value: trimValue(m[2]), offset: s + m.index });
		}
		if (kind !== "css") {
			for (const m of seg.matchAll(CAMEL_DECL)) {
				const map = {
					fontFamily: "font-family",
					fontWeight: "font-weight",
					fontStyle: "font-style",
					fontVariationSettings: "font-variation-settings",
				};
				decls.push({ prop: map[m[1]], value: (m[3] ?? m[4] ?? "").trim(), offset: s + m.index });
			}
		}
	}
	decls.sort((a, b) => a.offset - b.offset);
	return decls;
}

function parseShorthand(value) {
	const v = value.replace(/!important/i, "").trim();
	const m = v.match(
		/^(.*?)(?:^|\s)((?:\d*\.?\d+)(?:px|rem|em|%|pt|vw|vh|vmin|vmax|ch|ex|cap|lh)|xx-small|x-small|small|medium|large|x-large|xx-large|smaller|larger|(?:var|calc|clamp|min|max)\([^)]*\))(?:\s*\/\s*\S+)?\s+(.+)$/i,
	);
	if (!m) return null;
	const pre = m[1].trim().split(/\s+/).filter(Boolean);
	const out = { weights: [], italic: false, relative: false, unresolved: false, stack: parseStack(m[3]) };
	for (const tok of pre) {
		const lower = tok.toLowerCase();
		if (lower === "italic" || lower === "oblique") out.italic = true;
		const w = parseWeightToken(lower);
		if (w.weight && lower !== "normal") out.weights.push(w.weight);
		if (w.relative) out.relative = true;
		if (w.unresolved) out.unresolved = true;
	}
	return out;
}

function noteWeight(state, w) {
	if (w.relative) state.relativeWeightSeen = true;
	if (w.unresolved) state.unresolvedWeightSeen = true;
}

function analyseBlocks(state, { rel, text, kind, lineOf, dir, fontFileSet }) {
	const blocks = braceBlocks(text);
	const blockStack = new Map();
	for (const block of blocks) {
		const decls = blockDecls(text, block, kind);
		block.decls = decls;
		if (/@font-face$/i.test(block.prelude)) continue;
		const first = decls.find((d) => d.prop === "font-family");
		if (first) blockStack.set(block, parseStack(first.value));
		else {
			const sh = decls.find((d) => d.prop === "font");
			const parsed = sh && kind !== "script" ? parseShorthand(sh.value) : null;
			if (parsed?.stack.length) blockStack.set(block, parsed.stack);
		}
	}
	const inheritedStack = (block) => {
		for (let b = block; b && !b.isRoot; b = b.parent) if (blockStack.has(b)) return blockStack.get(b);
		return null;
	};

	for (const block of blocks) {
		if (/@font-face$/i.test(block.prelude)) {
			analyseFontFace(state, { rel, text, block, lineOf, dir, fontFileSet });
			continue;
		}
		const isTheme = /^@theme\b/i.test(block.prelude);
		const familyDecls = block.decls.filter((d) => d.prop === "font-family");
		for (const d of block.decls) {
			const line = lineOf(d.offset);
			// Which family does a weight / style / axis declaration in this block apply to?
			let stack = null;
			if (block.isRoot) {
				const same = familyDecls.find((f) => lineOf(f.offset) === line);
				stack = same ? parseStack(same.value) : null;
			} else stack = inheritedStack(block);

			if (d.prop === "font-family") {
				state.usages.push({ names: parseStack(d.value), file: rel, line, explicit: true });
			} else if (d.prop.startsWith("--font-")) {
				const names = parseStack(d.value);
				if (names.length) state.usages.push({ names, file: rel, line, explicit: true, tailwind: isTheme });
			} else if (d.prop.startsWith("--") && d.prop.includes("weight")) {
				const w = parseWeightToken(d.value);
				if (w.weight) {
					state.unattributedWeights.add(w.weight);
					state.customWeightProps++;
				}
			} else if (d.prop === "font-weight") {
				const w = parseWeightToken(d.value);
				noteWeight(state, w);
				if (w.weight) {
					if (stack?.length) state.usages.push({ names: stack, file: rel, line, weights: [w.weight] });
					else state.unattributedWeights.add(w.weight);
				}
			} else if (d.prop === "font-style") {
				if (/^(italic|oblique)/i.test(d.value) && stack?.length)
					state.usages.push({ names: stack, file: rel, line, italic: true });
			} else if (d.prop === "font-variation-settings") {
				const axes = [...d.value.matchAll(/["']([A-Za-z0-9]{4})["']/g)].map((m) => m[1]);
				if (axes.length && stack?.length) state.usages.push({ names: stack, file: rel, line, axes });
			} else if (d.prop === "font" && kind !== "script") {
				const p = parseShorthand(d.value);
				if (!p) continue;
				if (p.relative) state.relativeWeightSeen = true;
				if (p.unresolved) state.unresolvedWeightSeen = true;
				if (p.stack.length)
					state.usages.push({
						names: p.stack,
						file: rel,
						line,
						explicit: true,
						weights: p.weights,
						italic: p.italic,
					});
				else for (const w of p.weights) state.unattributedWeights.add(w);
			}
		}
	}
}

function resolveFontUrl(rawUrl, dir, fontFileSet) {
	const clean = rawUrl.split(/[?#]/)[0];
	if (!clean || /^data:/i.test(clean)) return null;
	const candidates = clean.startsWith("/")
		? [clean.slice(1), `public${clean}`, `static${clean}`, `src${clean}`]
		: [path.posix.normalize(dir ? `${dir}/${clean}` : clean)];
	for (const c of candidates) if (fontFileSet.has(c)) return c;
	return null;
}

function analyseFontFace(state, { rel, text, block, lineOf, dir, fontFileSet }) {
	const get = (prop) => block.decls.find((d) => d.prop === prop);
	const famDecl = get("font-family");
	const at = text.lastIndexOf("@font-face", block.open);
	const line = lineOf(at >= 0 ? at : block.open);
	if (!famDecl) return;
	const names = parseStack(famDecl.value);
	if (names.length !== 1) return;
	const e = familyEntry(state, names[0]);
	if (!e) return;
	addLocation(e, rel, line);

	// src may contain ";" inside data URIs or quotes only rarely; read the raw block text for url()/local().
	const body = block.segments.map(([s, en]) => text.slice(s, en)).join(" ");
	const urls = [...body.matchAll(/url\(\s*(["']?)([^"')]+)\1\s*\)/gi)].map((m) => m[2].trim());
	if (!urls.length) {
		e.load_methods.add("font-face-local-only");
		return;
	}
	e.load_methods.add("font-face");
	for (const u of urls) {
		if (/^(https?:)?\/\//i.test(u)) {
			const host = hostOf(u);
			if (host) addOrigin(state, host, rel, line);
		} else {
			if (!/^data:/i.test(u)) addOrigin(state, SELF_ORIGIN, rel, line);
			const f = resolveFontUrl(u, dir, fontFileSet);
			if (f) e.font_files.add(f);
		}
	}

	const wDecl = get("font-weight");
	if (wDecl) {
		const parts = wDecl.value.replace(/!important/i, "").trim().split(/\s+/);
		if (parts.length === 2) {
			const a = parseWeightToken(parts[0]).weight;
			const b = parseWeightToken(parts[1]).weight;
			if (a && b) e.weights_declared.add(`${Math.min(a, b)}..${Math.max(a, b)}`);
		} else {
			const w = parseWeightToken(parts[0]).weight;
			if (w) {
				e.weights_declared.add(w);
				state.declaredWeights.push({ key: familyKey(e.family), weight: w, file: rel, line, source: "@font-face" });
			}
		}
	} else {
		e.weights_declared.add(400);
	}

	const dDecl = get("font-display");
	let display = "missing";
	if (dDecl) {
		const v = dDecl.value.replace(/!important/i, "").trim().toLowerCase();
		display = DISPLAY_KEYWORDS.has(v) ? v : "unknown";
	}
	e.displays.add(display);
	state.faces.push({ family: e.family, file: rel, line, display });
}

function parseGoogleFamilies(u) {
	// Returns [{ name, weights:Set, ranges:Set, italic, axes:Set }]
	const out = [];
	let params;
	try {
		params = new URL(u.startsWith("//") ? `https:${u}` : u).searchParams;
	} catch {
		return { families: out, display: null };
	}
	const v2 = /\/css2\?/.test(u);
	for (const value of params.getAll("family")) {
		const specs = v2 ? [value] : value.split("|");
		for (const spec of specs) {
			const [rawName, axisSpec] = spec.split(":");
			const name = cleanName(rawName.replace(/\+/g, " "));
			if (!name) continue;
			const fam = { name, weights: new Set(), ranges: new Set(), italic: false, axes: new Set() };
			if (!axisSpec) fam.weights.add(400);
			else if (v2) {
				const [tagPart, valuePart = ""] = axisSpec.split("@");
				const tags = tagPart.split(",").map((t) => t.trim());
				for (const t of tags) if (t !== "ital" && t !== "wght") fam.axes.add(t);
				const tuples = valuePart ? valuePart.split(";") : [];
				for (const tuple of tuples) {
					const vals = tuple.split(",");
					tags.forEach((t, i) => {
						const val = (vals[i] ?? "").trim();
						if (t === "ital" && val === "1") fam.italic = true;
						if (t === "wght") {
							if (val.includes("..")) fam.ranges.add(val);
							else if (/^\d+$/.test(val)) fam.weights.add(Number(val));
						}
					});
				}
				if (!tags.includes("wght")) fam.weights.add(400);
			} else {
				for (const variant of axisSpec.split(",")) {
					const vv = variant.trim().toLowerCase();
					if (/i(talic)?$/.test(vv)) fam.italic = true;
					const num = vv.match(/^(\d+)/);
					if (num) fam.weights.add(Number(num[1]));
					else if (vv.startsWith("bold")) fam.weights.add(700);
					else fam.weights.add(400);
				}
			}
			out.push(fam);
		}
	}
	const d = params.get("display");
	return { families: out, display: d === null ? null : d.toLowerCase() };
}

// Find the HTML/JSX tag that contains offset, if it is a <link>.
function enclosingLinkTag(text, offset) {
	const open = text.lastIndexOf("<", offset);
	if (open < 0) return null;
	const closeBefore = text.lastIndexOf(">", offset);
	if (closeBefore > open) return null;
	if (!/^<link\b/i.test(text.slice(open, open + 6))) return null;
	const end = text.indexOf(">", offset);
	return text.slice(open, end < 0 ? text.length : end + 1);
}

function tagAttr(tag, name) {
	const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:\\{\\s*)?(["'\`])((?:(?!\\1).)*)\\1`, "i"));
	return m ? m[2] : null;
}

function insideNoscript(text, offset) {
	const open = text.toLowerCase().lastIndexOf("<noscript", offset);
	if (open < 0) return false;
	const close = text.toLowerCase().lastIndexOf("</noscript", offset);
	return close < open;
}

function isImportAt(text, offset) {
	const before = text.slice(Math.max(0, offset - 40), offset);
	return /@import\s+(?:url\(\s*)?["']?$/i.test(before);
}

function stylesheetLinkBlocks(tag) {
	const rels = (tagAttr(tag, "rel") || "").toLowerCase().split(/\s+/);
	if (!rels.includes("stylesheet")) return { stylesheet: false, blocking: false };
	const media = (tagAttr(tag, "media") || "").trim().toLowerCase();
	const blocking = media === "" || media === "all" || media === "screen";
	return { stylesheet: true, blocking };
}

function analyseGoogleUrls(state, { rel, text, kind, lineOf }) {
	const re = /(?:https?:)?\/\/fonts\.googleapis\.com\/css2?\?[^"'\s)<>`]+/gi;
	const seen = new Set();
	for (const m of text.matchAll(re)) {
		const url = m[0].replace(/&amp;/g, "&");
		const line = lineOf(m.index);
		const { families, display } = parseGoogleFamilies(url);
		addOrigin(state, "fonts.googleapis.com", rel, line);
		const names = [];
		for (const f of families) {
			const e = familyEntry(state, f.name);
			if (!e) continue;
			names.push(e.family);
			e.load_methods.add("google-fonts");
			addLocation(e, rel, line);
			for (const w of f.weights) {
				e.weights_declared.add(w);
				state.declaredWeights.push({
					key: familyKey(e.family),
					weight: w,
					file: rel,
					line,
					source: "Google Fonts URL",
				});
			}
			for (const r of f.ranges) e.weights_declared.add(r);
			if (f.italic) e.italic_used = true;
			for (const a of f.axes) e.axes_used.add(a);
			const dv = display === null ? "missing" : DISPLAY_KEYWORDS.has(display) ? display : "unknown";
			e.displays.add(dv);
		}

		const imported = isImportAt(text, m.index);
		const tag = kind === "css" ? null : enclosingLinkTag(text, m.index);
		if (imported) {
			state.findings.push({
				id: "render-blocking-google-css",
				family: null,
				file: rel,
				line,
				detail: `This @import of Google Fonts CSS${names.length ? ` (${names.join(", ")})` : ""} blocks rendering: the browser finds it only after the stylesheet that imports it has downloaded, then waits for another origin. Fix: replace it with a <link rel="stylesheet"> in the HTML head after a preconnect to https://fonts.googleapis.com and https://fonts.gstatic.com, or self-host the fonts.`,
			});
		} else if (tag) {
			const { blocking } = stylesheetLinkBlocks(tag);
			if (blocking && !insideNoscript(text, m.index)) {
				state.findings.push({
					id: "render-blocking-google-css",
					family: null,
					file: rel,
					line,
					detail: `This <link rel="stylesheet"> loads Google Fonts CSS${names.length ? ` (${names.join(", ")})` : ""} from another origin and blocks rendering until it arrives. Fix: preconnect to https://fonts.googleapis.com and https://fonts.gstatic.com, then load the stylesheet without blocking (media="print" with onload="this.media='all'", plus a <noscript> copy), or self-host the fonts.`,
				});
			}
		}

		const dedupe = `${url}`;
		if (seen.has(dedupe) || !names.length) continue;
		seen.add(dedupe);
		state.googleUrls.push({ file: rel, line, families: names, display });
	}
}

function analyseExternalStylesheets(state, { rel, text, kind, lineOf }) {
	const consider = (url, offset) => {
		const host = hostOf(url);
		if (!host || host === "fonts.googleapis.com") return;
		if (FONT_CSS_HOSTS.has(host) || /font/i.test(url)) addOrigin(state, host, rel, lineOf(offset));
	};
	for (const m of text.matchAll(/@import\s+(?:url\(\s*)?["']?((?:https?:)?\/\/[^"')\s;]+)/gi)) consider(m[1], m.index);
	if (kind === "css") return;
	for (const m of text.matchAll(/<link\b[^>]*>/gi)) {
		const tag = m[0];
		if (!stylesheetLinkBlocks(tag).stylesheet) continue;
		const href = tagAttr(tag, "href");
		if (href && /^(https?:)?\/\//i.test(href)) consider(href, m.index);
	}
}

function analyseFontsource(state, { rel, text, lineOf }) {
	const re = /["'](@fontsource(-variable)?\/([a-z0-9-]+))(\/[^"']*)?["']/g;
	for (const m of text.matchAll(re)) {
		const e = familyEntry(state, fontsourceFamily(m[3], Boolean(m[2])));
		if (!e) continue;
		const line = lineOf(m.index);
		const variable = Boolean(m[2]);
		e.load_methods.add(variable ? "fontsource-variable" : "fontsource");
		e.displays.add("unknown");
		addLocation(e, rel, line);
		addOrigin(state, SELF_ORIGIN, rel, line);
		const sub = (m[4] || "").replace(/^\//, "").replace(/\.css$/, "");
		if (/italic/.test(sub)) e.italic_used = true;
		if (variable) continue;
		const num = sub.match(/(?:^|-)(\d{3})(?:-|$)/);
		const w = num ? Number(num[1]) : sub === "" || sub === "index" ? 400 : null;
		if (w) {
			e.weights_declared.add(w);
			state.declaredWeights.push({ key: familyKey(e.family), weight: w, file: rel, line, source: "Fontsource import" });
		}
	}
}

function optionString(args, name) {
	const m = args.match(new RegExp(`\\b${name}\\s*:\\s*(["'\`])((?:(?!\\1).)*)\\1`));
	return m ? m[2] : null;
}
function optionList(args, name) {
	const m = args.match(new RegExp(`\\b${name}\\s*:\\s*(\\[[^\\]]*\\]|(["'\`])(?:(?!\\2).)*\\2)`));
	if (!m) return null;
	return m[1].startsWith("[") ? quotedStrings(m[1]) : [quotedStrings(m[1])[0]];
}

function analyseNextFont(state, { rel, text, lineOf, dir, fontFileSet }) {
	const callees = []; // { ident, family | null, local }
	for (const m of text.matchAll(/import\s*\{([^}]*)\}\s*from\s*["'](?:@next\/font|next\/font)\/google["']/g)) {
		for (const part of m[1].split(",")) {
			const [orig, alias] = part.trim().split(/\s+as\s+/);
			if (!orig) continue;
			callees.push({ ident: (alias || orig).trim(), family: orig.trim().replace(/_/g, " "), local: false });
		}
	}
	for (const m of text.matchAll(/import\s+([A-Za-z_$][\w$]*)\s+from\s*["'](?:@next\/font|next\/font)\/local["']/g))
		callees.push({ ident: m[1], family: null, local: true });

	for (const callee of callees) {
		const re = new RegExp(`(?:(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=\\s*)?(?<![\\w$.])${callee.ident.replace(/\$/g, "\\$")}\\s*\\(`, "g");
		for (const m of text.matchAll(re)) {
			const open = m.index + m[0].length - 1;
			const close = matchingClose(text, open, "(", ")");
			const args = text.slice(open + 1, close);
			const line = lineOf(m.index + m[0].lastIndexOf(callee.ident));
			analyseNextCall(state, { rel, line, args, callee, varName: m[1] || null, dir, fontFileSet });
		}
	}
}

function analyseNextCall(state, { rel, line, args, callee, varName, dir, fontFileSet }) {
	let familyName = callee.family;
	const paths = [];
	if (callee.local) {
		const srcString = optionString(args, "src");
		if (srcString && !/\bsrc\s*:\s*\[/.test(args)) paths.push(srcString);
		for (const pm of args.matchAll(/\bpath\s*:\s*(["'`])((?:(?!\1).)*)\1/g)) paths.push(pm[2]);
		if (!paths.length) return;
		familyName = familyFromFontPath(paths[0]);
	}
	const e = familyEntry(state, familyName);
	if (!e) return;
	e.load_methods.add(callee.local ? "next-font-local" : "next-font-google");
	addLocation(e, rel, line);
	addOrigin(state, SELF_ORIGIN, rel, line);
	if (varName) e.nextIdents.add(varName);

	const displayRaw = /\bdisplay\s*:/.test(args) ? optionString(args, "display") : undefined;
	const display =
		displayRaw === undefined ? "swap" : displayRaw && DISPLAY_KEYWORDS.has(displayRaw.toLowerCase()) ? displayRaw.toLowerCase() : "unknown";
	e.displays.add(display);

	if (callee.local) {
		for (const p of paths) {
			const f = resolveFontUrl(p, dir, fontFileSet);
			if (f) e.font_files.add(f);
		}
		for (const wm of args.matchAll(/\bweight\s*:\s*(["'`])((?:(?!\1).)*)\1/g)) {
			const parts = wm[2].trim().split(/\s+/);
			if (parts.length === 2) e.weights_declared.add(`${parts[0]}..${parts[1]}`);
			else if (/^\d+$/.test(parts[0])) {
				e.weights_declared.add(Number(parts[0]));
				state.declaredWeights.push({ key: familyKey(e.family), weight: Number(parts[0]), file: rel, line, source: "next/font weight" });
			}
		}
		if (/\bstyle\s*:\s*(["'`])italic\1/.test(args)) e.italic_used = true;
	} else {
		const weights = optionList(args, "weight");
		if (weights) {
			for (const w of weights) {
				if (/^\d+$/.test(w)) {
					e.weights_declared.add(Number(w));
					state.declaredWeights.push({ key: familyKey(e.family), weight: Number(w), file: rel, line, source: "next/font weight" });
				} else if (w === "variable") e.weights_declared.add("variable");
			}
		}
		const styles = optionList(args, "style");
		if (styles?.includes("italic")) e.italic_used = true;
		const axes = optionList(args, "axes");
		for (const a of axes || []) e.axes_used.add(a);
	}
	const subsets = callee.local ? null : optionList(args, "subsets");
	const preloadOff = /\bpreload\s*:\s*false\b/.test(args);
	state.nextCalls.push({ family: e.family, file: rel, line, display, local: callee.local, subsets, preloadOff });
}

function analyseMarkupWeights(state, text) {
	for (const m of text.matchAll(/(?<![\w-])font-(thin|extralight|light|normal|medium|semibold|bold|extrabold|black)(?![\w-])/g))
		state.unattributedWeights.add(TAILWIND_WEIGHTS[m[1]]);
	for (const m of text.matchAll(/(?<![\w-])font-\[(\d{3})\]/g)) state.unattributedWeights.add(Number(m[1]));
	if (/<(b|strong|h[1-6]|th)[\s>]/i.test(text)) state.unattributedWeights.add(700);
}

function analyseTailwindConfig(state, { rel, text, lineOf }) {
	for (const m of text.matchAll(/\bfontFamily\s*:\s*\{/g)) {
		const open = m.index + m[0].length - 1;
		const close = matchingClose(text, open, "{", "}");
		const body = text.slice(open + 1, close);
		const re = /(?:^|[,{\s])([A-Za-z_$][\w$-]*|["'][^"']+["'])\s*:\s*(\[[^\]]*\]|["'][^"']*["'])/g;
		for (const em of body.matchAll(re)) {
			const value = em[2];
			const names = value.startsWith("[")
				? quotedStrings(value).flatMap((s) => parseStack(s))
				: parseStack(quotedStrings(value)[0] ?? "");
			if (!names.length) continue;
			const line = lineOf(open + 1 + em.index + em[0].indexOf(em[1]));
			state.usages.push({ names, file: rel, line, explicit: true, tailwind: true });
		}
	}
}

// ---------------------------------------------------------------------------------------------
// Findings

function fontFaceDisplayFinding(face) {
	const { family, display } = face;
	const icon = isIconFamily(family);
	let id;
	let obs;
	let fix;
	if (display === "missing" || display === "auto") {
		id = "missing-font-display";
		if (icon) {
			obs =
				display === "missing"
					? `This @font-face for "${family}", which looks like an icon font, has no font-display, so the browser decides how the icons load.`
					: `This @font-face for "${family}", which looks like an icon font, sets font-display: auto, so the browser decides how the icons load.`;
			fix = display === "missing" ? `Fix: add "font-display: block;" to this rule.` : `Fix: change it to "font-display: block;".`;
		} else if (display === "missing") {
			obs = `No font-display on this @font-face for "${family}": the browser default (auto) can hide the text for up to about 3 seconds while the font downloads.`;
			fix = `Fix: add "font-display: swap;" to this rule.`;
		} else {
			obs = `font-display: auto on this @font-face for "${family}" is the same as leaving it out: the browser decides, and it can hide the text for up to about 3 seconds while the font downloads.`;
			fix = `Fix: change it to "font-display: swap;".`;
		}
		return displayFinding(id, family, face, obs, icon, fix);
	}
	if (display === "block" && !icon) {
		obs = `font-display: block on this @font-face for "${family}" can hide the text for up to about 3 seconds while the font downloads.`;
		fix = `Fix: change it to "font-display: swap;". Keep block only if "${family}" is an icon font.`;
		return displayFinding("font-display-block", family, face, obs, false, fix);
	}
	return null;
}

function displayFinding(id, family, where, observation, icon, fix) {
	return {
		id,
		family,
		file: where.file,
		line: where.line,
		detail: [observation, FONT_DISPLAY_RULE, icon ? ICON_REASON : FONT_DISPLAY_REASON, fix].join(" "),
	};
}

function googleDisplayFinding(g) {
	const families = g.families.join(", ");
	const icon = g.families.length > 0 && g.families.every(isIconFamily);
	const d = g.display;
	if (d === null || d === "auto") {
		let obs;
		let fix;
		if (icon) {
			obs =
				d === null
					? `This Google Fonts URL${families ? ` (${families})` : ""}, which looks like an icon font, has no display parameter, so the browser decides how the icons load.`
					: `This Google Fonts URL${families ? ` (${families})` : ""}, which looks like an icon font, sets display=auto, so the browser decides how the icons load.`;
			fix = d === null ? `Fix: add "&display=block" to the URL.` : `Fix: set "display=block" in the URL.`;
		} else if (d === null) {
			obs = `This Google Fonts URL${families ? ` (${families})` : ""} has no display parameter, so the rules it returns leave font-display to the browser, which can hide the text for up to about 3 seconds.`;
			fix = `Fix: add "&display=swap" to the URL.`;
		} else {
			obs = `This Google Fonts URL${families ? ` (${families})` : ""} sets display=auto, so the rules it returns leave font-display to the browser, which can hide the text for up to about 3 seconds.`;
			fix = `Fix: set "display=swap" in the URL.`;
		}
		return displayFinding("missing-font-display", null, g, obs, icon, fix);
	}
	if (d === "block" && !icon) {
		const obs = `This Google Fonts URL${families ? ` (${families})` : ""} sets display=block, which can hide the text for up to about 3 seconds while the fonts download.`;
		return displayFinding("font-display-block", null, g, obs, false, `Fix: set "display=swap" in the URL.`);
	}
	return null;
}

function nextDisplayFinding(c) {
	const icon = isIconFamily(c.family);
	const nextFix = `Fix: remove the display option (next/font defaults to "swap") or set display: "swap".`;
	if (c.display === "auto") {
		if (icon) {
			const obs = `next/font loads "${c.family}", which looks like an icon font, with display: "auto", so the browser decides how the icons load.`;
			return displayFinding("missing-font-display", c.family, c, obs, true, `Fix: set display: "block".`);
		}
		const obs = `next/font loads "${c.family}" with display: "auto": the browser decides, and it can hide the text for up to about 3 seconds while the font downloads.`;
		return displayFinding("missing-font-display", c.family, c, obs, false, nextFix);
	}
	if (c.display === "block" && !icon) {
		const obs = `next/font loads "${c.family}" with display: "block", which can hide the text for up to about 3 seconds while the font downloads.`;
		return displayFinding("font-display-block", c.family, c, obs, false, nextFix);
	}
	return null;
}

function subsetFindings(calls) {
	const out = [];
	const google = calls.filter((c) => !c.local);
	for (const c of google) {
		if ((!c.subsets || c.subsets.length === 0) && !c.preloadOff) {
			out.push({
				id: "nextfont-subset-mismatch",
				family: c.family,
				file: c.file,
				line: c.line,
				detail: `next/font/google loads "${c.family}" with preload on (the default) but no subsets, so Next.js cannot tell which files to preload and warns or fails the build. Fix: add the subsets your text uses, for example subsets: ["latin"], or set preload: false.`,
			});
		}
	}
	const withSubsets = google.filter((c) => c.subsets?.length && !c.preloadOff);
	const union = [...new Set(withSubsets.flatMap((c) => c.subsets))].sort(cmp);
	for (const c of withSubsets) {
		const missing = union.filter((s) => !c.subsets.includes(s));
		if (!missing.length) continue;
		out.push({
			id: "nextfont-subset-mismatch",
			family: c.family,
			file: c.file,
			line: c.line,
			detail: `next/font/google preloads "${c.family}" for ${[...c.subsets].sort(cmp).join(", ")} only, while other next/font calls in this project also preload ${missing.join(", ")}. Text in those subsets gets a "${c.family}" file that is not preloaded and can swap in late. Fix: give every next/font call the subsets your text uses.`,
		});
	}
	return out;
}

function unusedWeightFindings(state) {
	if (state.relativeWeightSeen) return [];
	if (state.unresolvedWeightSeen && state.customWeightProps === 0) return [];
	const out = [];
	const seen = new Set();
	for (const d of state.declaredWeights) {
		const e = state.families.get(d.key);
		if (!e || !e.used || d.weight === 400 || isIconFamily(e.family)) continue;
		if (e.weights_used.has(d.weight) || state.unattributedWeights.has(d.weight)) continue;
		const k = `${d.key}|${d.weight}|${d.file}|${d.line}`;
		if (seen.has(k)) continue;
		seen.add(k);
		out.push({
			id: "unused-face-weight",
			family: e.family,
			file: d.file,
			line: d.line,
			detail: `"${e.family}" declares weight ${d.weight} here (${d.source}), but nothing in the scanned files sets font-weight ${d.weight} where this family could apply. Fix: remove this weight, unless something the scan cannot see applies it (styles set by scripts, CMS content).`,
		});
	}
	return out;
}

function mixedCdnFinding(state) {
	const origins = [...state.origins.entries()].sort((a, b) => cmp(a[1].sortKey, b[1].sortKey));
	if (origins.length < 2) return null;
	const list = origins.map(([o, w]) => `${o} (first at ${w.file}:${w.line})`).join(", ");
	const second = origins[1][1];
	return {
		id: "mixed-cdn",
		family: null,
		file: second.file,
		line: second.line,
		detail: `Web fonts load from ${origins.length} origins: ${list}. Each extra origin needs its own connection before its fonts can download, and fonts split across hosts are harder to preload, cache and audit. Fix: serve all web fonts from one origin, ideally your own.`,
	};
}

function sortWeights(set) {
	const nums = [...set].filter((w) => typeof w === "number").sort((a, b) => a - b);
	const rest = [...set].filter((w) => typeof w !== "number").map(String).sort(cmp);
	return [...nums, ...rest];
}

export function sortFindings(findings) {
	return [...findings].sort(
		(a, b) =>
			cmp(a.file ?? "", b.file ?? "") ||
			(a.line ?? 0) - (b.line ?? 0) ||
			cmp(a.id, b.id) ||
			cmp(a.family ?? "", b.family ?? "") ||
			cmp(a.detail, b.detail),
	);
}

function resolveUsages(state) {
	const declared = (key) => {
		const e = state.families.get(key);
		return e && e.load_methods.size > 0;
	};
	for (const u of state.usages) {
		const names = u.names.filter((n) => isUsableName(n) && !isGeneric(n));
		if (!names.length) continue;
		const targets = [names[0], ...names.slice(1).filter((n) => declared(familyKey(n)))];
		const primary = familyEntry(state, names[0]);
		for (const n of targets) {
			const e = familyEntry(state, n);
			if (!e) continue;
			e.used = true;
			if (u.explicit) addLocation(e, u.file, u.line);
			if (u.tailwind && e === primary) e.load_methods.add("tailwind");
		}
		if (!primary) continue;
		for (const w of u.weights || []) primary.weights_used.add(w);
		if (u.italic) primary.italic_used = true;
		for (const a of u.axes || []) primary.axes_used.add(a);
	}
	for (const e of state.families.values()) {
		for (const id of e.nextIdents) if (state.memberRefs.has(id)) e.used = true;
	}
}

export function scan(rootDir, { all = false } = {}) {
	const root = path.resolve(rootDir);
	const { files, fontFiles, stats } = walk(root, { all });
	const fontFileSet = new Set(fontFiles);
	const state = createState();
	let binary = 0;
	for (const rel of files) {
		let text;
		try {
			text = fs.readFileSync(path.join(root, rel), "utf8");
		} catch {
			continue;
		}
		if (text.includes("\u0000")) {
			binary++;
			continue;
		}
		analyseFile(state, { rel, text, fontFileSet });
	}
	resolveUsages(state);

	const findings = [...state.findings];
	for (const face of state.faces) {
		const f = fontFaceDisplayFinding(face);
		if (f) findings.push(f);
	}
	for (const g of state.googleUrls) {
		const f = googleDisplayFinding(g);
		if (f) findings.push(f);
	}
	for (const c of state.nextCalls) {
		const f = nextDisplayFinding(c);
		if (f) findings.push(f);
	}
	findings.push(...subsetFindings(state.nextCalls));
	findings.push(...unusedWeightFindings(state));
	const mixed = mixedCdnFinding(state);
	if (mixed) findings.push(mixed);

	const families = [...state.families.entries()]
		.sort((a, b) => cmp(a[0], b[0]))
		.map(([, e]) => {
			const displays = [...e.displays].sort(cmp);
			return {
				family: e.family,
				weights_declared: sortWeights(e.weights_declared),
				weights_used: sortWeights(e.weights_used),
				italic_used: e.italic_used,
				axes_used: [...e.axes_used].sort(cmp),
				font_display: displays.length === 0 ? null : displays.length === 1 ? displays[0] : displays,
				load_methods: [...e.load_methods].sort(cmp),
				font_files: [...e.font_files].sort(cmp),
				locations: [...e.locations.entries()].sort((a, b) => cmp(a[0], b[0])).map(([, l]) => l),
			};
		});

	const sorted = sortFindings(findings);
	return {
		schema: SCHEMA,
		skill_version: SKILL_VERSION,
		families,
		findings: sorted,
		stats: {
			...stats,
			skipped_too_large: [...stats.skipped_too_large].sort(cmp),
			non_shipping_skipped: [...stats.non_shipping_skipped].sort(cmp),
			files_skipped_binary: binary,
			weights_used_unattributed: sortWeights(state.unattributedWeights),
			families: families.length,
			findings: sorted.length,
		},
	};
}

// ---------------------------------------------------------------------------------------------
// Catalogue findings: built by the agent from one resolve_fonts response (and, optionally,
// lookup_license responses keyed by licence id). Pure function; nothing here touches the network.

export const CATALOGUE_FINDING_IDS = [
	"weight-not-available",
	"italic-not-available",
	"axis-not-available",
	"licence-flags",
	"not-in-catalogue",
];

// The family names to send to resolve_fonts: every family the scan found, minus CSS generics and
// local()-only fallback faces. Batches of 25.
export function familiesForCatalogue(scanResult) {
	const names = scanResult.families
		.filter((f) => !isGeneric(f.family))
		.filter((f) => !(f.load_methods.length === 1 && f.load_methods[0] === "font-face-local-only"))
		.map((f) => f.family);
	const batches = [];
	for (let i = 0; i < names.length; i += 25) batches.push(names.slice(i, i + 25));
	return { names, batches };
}

// The catalogue's stored flags for licences whose files may not be modified or redistributed, copied here
// so a default audit (one resolve_fonts call, family names only) can still name them. Live
// lookup_license data, when the agent passes it in after a follow-up, takes precedence.
export const KNOWN_LICENCE_FLAGS = {
	"ITF Free Font License": {
		modification_allowed: false,
		redistribution_allowed: false,
		official_url: "https://www.fontshare.com/licenses/itf-ffl",
	},
};

const yn = (v) => (v === true ? "yes" : v === false ? "no" : "unknown");

function describeWeights(font) {
	const parts = [];
	if (Array.isArray(font.weights) && font.weights.length) parts.push(`weights ${font.weights.join(", ")}`);
	const wght = Array.isArray(font.variable_axes) ? font.variable_axes.find((a) => a.axis === "wght") : null;
	if (wght) parts.push(`a wght axis from ${wght.min} to ${wght.max}`);
	return parts.join(" and ");
}

export function catalogueFindings(scanResult, resolveResponses, licences = {}) {
	const responses = Array.isArray(resolveResponses) ? resolveResponses : [resolveResponses];
	const results = new Map();
	for (const r of responses) for (const item of r?.results || []) results.set(familyKey(item.query), item);
	const lic = (id) => {
		const v = licences?.[id];
		return v?.license ?? v ?? null;
	};
	const out = [];
	for (const fam of scanResult.families) {
		const item = results.get(familyKey(fam.family));
		if (!item) continue;
		const where = fam.locations[0] || { file: null, line: null };
		const push = (id, detail) => out.push({ id, family: fam.family, file: where.file, line: where.line, detail });

		if (item.status === "not_in_catalogue") {
			const close = (item.candidates || []).map((c) => c.name).join(", ");
			push(
				"not-in-catalogue",
				`"${fam.family}" is not in our data, so its weights, italics, axes and licence were not checked. That is not a problem in itself.${close ? ` Close names in the catalogue: ${close}.` : ""}`,
			);
			continue;
		}
		if (item.status === "ambiguous") {
			const names = (item.candidates || []).map((c) => c.name).join(", ");
			push(
				"not-in-catalogue",
				`"${fam.family}" matches more than one entry in our data (${names}), so its weights, italics, axes and licence were not checked.`,
			);
			continue;
		}
		if (item.status !== "found" || !item.font) continue;
		const font = item.font;
		const label = font.name || fam.family;

		const wght = Array.isArray(font.variable_axes) ? font.variable_axes.find((a) => a.axis === "wght") : null;
		const weightsKnown = Array.isArray(font.weights) || Boolean(wght);
		if (weightsKnown) {
			const wanted = [...new Set([...fam.weights_declared, ...fam.weights_used].filter((w) => typeof w === "number"))].sort(
				(a, b) => a - b,
			);
			for (const w of wanted) {
				const ok = (Array.isArray(font.weights) && font.weights.includes(w)) || (wght && w >= wght.min && w <= wght.max);
				if (ok) continue;
				push(
					"weight-not-available",
					`"${fam.family}" is declared or used at weight ${w}, but our data for ${label} lists ${describeWeights(font) || "no weights"}. At weight ${w} the browser will substitute the nearest weight or synthesize it.`,
				);
			}
		}
		if (fam.italic_used && font.italics === false) {
			push(
				"italic-not-available",
				`"${fam.family}" is used in italic, but our data for ${label} has no italic. The browser will synthesize a slanted copy of the upright face.`,
			);
		}
		if (Array.isArray(font.variable_axes)) {
			const have = font.variable_axes.map((a) => a.axis);
			for (const axis of fam.axes_used) {
				if (have.includes(axis)) continue;
				const desc = have.length ? `the axes ${have.join(", ")}` : "no variable axes (a static font)";
				push(
					"axis-not-available",
					`"${fam.family}" sets the "${axis}" axis, but our data for ${label} lists ${desc}. The browser ignores an axis the font does not have.`,
				);
			}
		}

		if (font.license_id) {
			const live = lic(font.license_id);
			const known = live || KNOWN_LICENCE_FLAGS[font.license_id] || null;
			const parts = [`"${fam.family}": the licence on record for ${label} is ${font.license_id}.`];
			if (live) {
				parts.push(
					`Stored flags: commercial use ${yn(live.commercial_use)}, modification ${yn(live.modification_allowed)}, redistribution ${yn(live.redistribution_allowed)}, attribution required ${yn(live.attribution_required)}, copyleft ${yn(live.copyleft)}.`,
				);
			}
			const files = fam.font_files || [];
			if (files.length) {
				const shown = files.slice(0, 3).join(", ") + (files.length > 3 ? ", …" : "");
				const held = `The repo holds ${files.length} font file${files.length === 1 ? "" : "s"} for this family (${shown}).`;
				if (known && (known.modification_allowed === false || known.redistribution_allowed === false)) {
					const flags = [];
					if (known.modification_allowed === false) flags.push("no modifying, subsetting or converting the font files");
					if (known.redistribution_allowed === false) flags.push("no redistributing them");
					parts.push(
						`${held} The stored flags say ${flags.join(" and ")}. If these are not the foundry's official files as distributed, read the official licence before you ship them.`,
					);
				} else if (!known) {
					parts.push(
						`${held} Look up this licence's modification and redistribution flags (lookup_license) before you subset, convert or redistribute them.`,
					);
				}
			}
			if (known?.official_url) parts.push(`Official licence: ${known.official_url}`);
			else parts.push(`Flags not looked up in this run; the licence guide lists them: ${LICENCE_GUIDE_URL}`);
			push("licence-flags", parts.join(" "));
		} else if (font.kind === "premium" || font.kind === "system") {
			push(
				"licence-flags",
				`"${fam.family}" is a ${font.kind} font in our catalogue (${label}). Our data holds no licence terms for it; its licence comes from the foundry or vendor you got it from. Catalogue page: ${font.page_url}`,
			);
		}
	}
	return sortFindings(out);
}

// ---------------------------------------------------------------------------------------------
// CLI

export function formatText(r) {
	const lines = [];
	lines.push(
		`Webfont Audit ${r.skill_version} · scan ${r.schema} · ${r.stats.files_scanned} files scanned, ${r.families.length} families, ${r.findings.length} findings`,
	);
	if (r.stats.file_limit_reached)
		lines.push(`Stopped at the ${r.stats.file_limit}-file limit: files after that were not scanned.`);
	if (r.stats.files_skipped_too_large)
		lines.push(`Skipped ${r.stats.files_skipped_too_large} files over ${r.stats.max_file_bytes} bytes.`);
	const skippedDirs = r.stats.non_shipping_skipped ?? [];
	const skippedMore = r.stats.non_shipping_skipped_more ?? 0;
	const skippedFiles = r.stats.files_skipped_non_shipping ?? 0;
	if (skippedDirs.length || skippedFiles)
		lines.push(
			`Not scanned (tests, fixtures, docs, caches; --all includes them): ${skippedDirs.join(", ") || "no folders"}${skippedMore ? ` (+${skippedMore} more)` : ""}; ${skippedFiles} test/spec/story files.`,
		);
	lines.push("");
	lines.push("Families:");
	for (const f of r.families) {
		const fd = Array.isArray(f.font_display) ? f.font_display.join("/") : (f.font_display ?? "-");
		lines.push(
			`  ${f.family}: declared ${f.weights_declared.join(", ") || "-"}; used ${f.weights_used.join(", ") || "-"}; italic ${f.italic_used ? "yes" : "no"}; font-display ${fd}; via ${f.load_methods.join(", ") || "font-family only"}`,
		);
	}
	lines.push("");
	lines.push("Findings:");
	if (!r.findings.length) lines.push("  none");
	for (const f of r.findings) lines.push(`  [${f.id}] ${f.file}:${f.line}${f.family ? ` (${f.family})` : ""}: ${f.detail}`);
	return `${lines.join("\n")}\n`;
}

function isMain() {
	if (!process.argv[1]) return false;
	try {
		return fs.realpathSync(fileURLToPath(import.meta.url)) === fs.realpathSync(process.argv[1]);
	} catch {
		return false;
	}
}

if (isMain()) {
	const args = process.argv.slice(2);
	if (args.includes("--help") || args.includes("-h")) {
		process.stdout.write("Usage: node scan-fonts.mjs <project dir> [--json] [--all]\n");
		process.exit(0);
	}
	const dir = args.find((a) => !a.startsWith("--"));
	if (!dir || !fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
		process.stderr.write("Usage: node scan-fonts.mjs <project dir> [--json] [--all]  (the directory must exist)\n");
		process.exit(2);
	}
	const result = scan(dir, { all: args.includes("--all") });
	process.stdout.write(args.includes("--json") ? `${JSON.stringify(result, null, 2)}\n` : formatText(result));
}
