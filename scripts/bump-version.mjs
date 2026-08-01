#!/usr/bin/env node
// Bumps one plugin's version in every place it is recorded, so plugin.json and the
// marketplace entry can never drift apart (check-repo CHK-005 enforces the same invariant).
//
// Usage: node scripts/bump-version.mjs <plugin-name> <major|minor|patch>

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const MARKETPLACE = path.join(ROOT, ".claude-plugin", "marketplace.json");

const LEVELS = ["major", "minor", "patch"];
const SEMVER_RE = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/;
const USAGE = "usage: node scripts/bump-version.mjs <plugin-name> <major|minor|patch>";

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

const readJson = async (p) => JSON.parse(await fs.readFile(p, "utf8"));
const writeJson = async (p, value) => fs.writeFile(p, `${JSON.stringify(value, null, 2)}\n`);

const bump = (version, level) => {
  const match = SEMVER_RE.exec(version);
  if (!match) fail(`"${version}" is not a plain X.Y.Z version and cannot be bumped automatically`);
  const [major, minor, patch] = match.slice(1, 4).map(Number);
  if (level === "major") return `${major + 1}.0.0`;
  if (level === "minor") return `${major}.${minor + 1}.0`;
  return `${major}.${minor}.${patch + 1}`;
};

const [name, level] = process.argv.slice(2);
if (!name || !LEVELS.includes(level)) fail(USAGE);

const marketplace = await readJson(MARKETPLACE);
const entry = marketplace.plugins?.find((p) => p.name === name);
if (!entry) {
  const known = (marketplace.plugins ?? []).map((p) => p.name).join(", ");
  fail(`unknown plugin "${name}". Known plugins: ${known || "(none)"}`);
}

const manifestPath = path.join(ROOT, entry.source, ".claude-plugin", "plugin.json");
const manifest = await readJson(manifestPath).catch(() => fail(`could not read ${path.relative(ROOT, manifestPath)}`));

if (entry.version !== manifest.version) {
  fail(
    `${name} versions already disagree — marketplace "${entry.version}" vs plugin.json "${manifest.version}". Reconcile them first.`,
  );
}

const oldVersion = entry.version;
const newVersion = bump(oldVersion, level);
const oldMarketplaceVersion = marketplace.metadata.version;
const newMarketplaceVersion = bump(oldMarketplaceVersion, "patch");

manifest.version = newVersion;
entry.version = newVersion;
marketplace.metadata.version = newMarketplaceVersion;

await writeJson(manifestPath, manifest);
await writeJson(MARKETPLACE, marketplace);

console.log(
  `bumped ${name} ${oldVersion} -> ${newVersion}, marketplace ${oldMarketplaceVersion} -> ${newMarketplaceVersion}`,
);
console.log("next: node scripts/gen-readme.mjs");
