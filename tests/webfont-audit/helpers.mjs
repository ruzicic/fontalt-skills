import path from "node:path";
import { fileURLToPath } from "node:url";

export const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const SKILL_DIR = path.join(REPO, "skills/webfont-audit");
export const SCRIPT = path.join(SKILL_DIR, "scripts/scan-fonts.mjs");
export const FIXTURES = path.join(REPO, "fixtures/webfont-audit");
export const CASES = ["css-fontface", "google-link", "tailwind", "next-font", "fontsource", "itf-selfhost", "unknown-commercial"];
