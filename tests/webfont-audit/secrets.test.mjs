// No key or token anywhere in the repo (tracked and untracked-but-not-ignored files).
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { REPO } from "./helpers.mjs";

const PATTERNS = [
	["OpenAI / Anthropic style key", /\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}/],
	["GitHub token", /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/],
	["GitHub fine-grained token", /\bgithub_pat_[A-Za-z0-9_]{20,}/],
	["PostHog project key", /\bphc_[A-Za-z0-9]{20,}/],
	["PostHog personal key", /\bphx_[A-Za-z0-9]{20,}/],
	["AWS access key", /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/],
	["Google API key", /\bAIza[0-9A-Za-z_-]{35}\b/],
	["Slack token", /\bxox[abposr]-[A-Za-z0-9-]{10,}/],
	["Stripe key", /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/],
	["npm token", /\bnpm_[A-Za-z0-9]{36}\b/],
	["Cloudflare API token assignment", /CLOUDFLARE_API_TOKEN\s*[=:]\s*["']?[A-Za-z0-9_-]{20,}/],
	["private key block", /-----BEGIN (?:RSA |EC |OPENSSH |DSA |ED25519 |PGP )?PRIVATE KEY( BLOCK)?-----/],
	["key or secret assignment", /\b(?:api[_-]?key|apikey|secret|token|password|passwd|access[_-]?key)\s*[=:]\s*["'][A-Za-z0-9_\-+/=]{16,}["']/i],
	["key in a URL query", /[?&](?:api_key|apikey|access_token|token|key)=[A-Za-z0-9_-]{16,}/i],
];

test("no key or token in any tracked or unignored file", () => {
	const out = execFileSync("git", ["ls-files", "-z", "--cached", "--others", "--exclude-standard"], { cwd: REPO, encoding: "utf8" });
	const files = out.split("\0").filter(Boolean);
	assert.ok(files.length > 50, "git listed the repo");
	const hits = [];
	for (const rel of files) {
		const abs = path.join(REPO, rel);
		if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
		const buf = fs.readFileSync(abs);
		if (buf.includes(0)) continue; // binary (fonts, images)
		const text = buf.toString("utf8");
		for (const [name, re] of PATTERNS) {
			const m = text.match(re);
			if (m) hits.push(`${rel}: ${name}`);
		}
	}
	assert.deepEqual(hits, []);
});

test("no .env file is tracked", () => {
	const out = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], { cwd: REPO, encoding: "utf8" });
	assert.deepEqual(out.split("\n").filter((f) => /(^|\/)\.env(\.|$)/.test(f)), []);
});
