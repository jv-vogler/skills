#!/usr/bin/env node
// Repo invariants the marketplace JSON schema cannot express.
// `claude plugin validate . --strict` owns schema correctness; this owns
// directory/name agreement, version agreement, README freshness, and the privacy scan.
//
// Usage: node scripts/check-repo.mjs

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const ROOT = path.resolve(import.meta.dirname, "..");
const MARKETPLACE = path.join(ROOT, ".claude-plugin", "marketplace.json");
const PLUGINS_DIR = path.join(ROOT, "plugins");
const README = path.join(ROOT, "README.md");

const MARKETPLACE_NAME_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;
const PLUGIN_NAME_RE = /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?$/;
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/;
const MAX_DESCRIPTION = 400;

// SEC-001. Each needle is split so this file holds no forbidden substring literally —
// it must survive its own scan, and CI's independent `git grep` for the same patterns.
const PRIVATE_STRINGS = [
  ["/home/", "jvogler"].join(""),
  ["jvsvogler", "@gmail.com"].join(""),
  ["joao.vogler@", "code", "miner", "42.com"].join(""),
  ["code", "miner"].join(""),
];

const errors = [];
const addError = (msg) => errors.push(msg);

const readJson = async (p) => {
  const text = await fs.readFile(p, "utf8");
  return JSON.parse(text);
};

const exists = async (p) => {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
};

const rel = (p) => path.relative(ROOT, p) || ".";

/**
 * Minimal YAML frontmatter reader: enough for SKILL.md headers, which use plain
 * scalars, quoted scalars, `>` and `|` block scalars, and `- ` sequences.
 * Returns an object of string (or string[]) values, or null when no frontmatter.
 */
const parseFrontmatter = (text) => {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) return null;

  const lines = match[1].split(/\r?\n/);
  const result = {};
  let key = null;
  let block = null; // { indent: number|null, lines: string[] }
  let sequence = null;

  const flush = () => {
    if (key === null) return;
    if (block) result[key] = block.lines.join("\n").trim();
    else if (sequence) result[key] = sequence;
    block = null;
    sequence = null;
    key = null;
  };

  const unquote = (v) => {
    const t = v.trim();
    if (t.length >= 2 && ((t[0] === '"' && t.at(-1) === '"') || (t[0] === "'" && t.at(-1) === "'"))) {
      return t.slice(1, -1);
    }
    return t;
  };

  for (const line of lines) {
    const indented = /^\s/.test(line);

    if (block && (indented || line.trim() === "")) {
      if (block.indent === null && line.trim() !== "") {
        block.indent = line.length - line.trimStart().length;
      }
      block.lines.push(block.indent === null ? line.trim() : line.slice(block.indent));
      continue;
    }

    if (sequence && indented && line.trim().startsWith("- ")) {
      sequence.push(unquote(line.trim().slice(2)));
      continue;
    }

    if (line.trim() === "") continue;

    const kv = /^([A-Za-z0-9_-]+):\s?(.*)$/.exec(line);
    if (!kv) continue;

    flush();
    key = kv[1];
    const value = kv[2];

    if (value.trim() === ">" || value.trim() === "|" || value.trim() === ">-" || value.trim() === "|-") {
      block = { indent: null, lines: [] };
    } else if (value.trim() === "") {
      sequence = [];
    } else if (value.trim().startsWith("[") && value.trim().endsWith("]")) {
      result[key] = value
        .trim()
        .slice(1, -1)
        .split(",")
        .map(unquote)
        .filter((s) => s !== "");
      key = null;
    } else {
      result[key] = unquote(value);
      key = null;
    }
  }
  flush();

  return result;
};

const checkMarketplace = (mp) => {
  // CHK-001
  if (!MARKETPLACE_NAME_RE.test(mp.name ?? "")) {
    addError(`CHK-001 marketplace.json name "${mp.name}" does not match ${MARKETPLACE_NAME_RE}`);
  }
  if (!mp.owner || typeof mp.owner !== "object" || !mp.owner.name) {
    addError("CHK-001 marketplace.json is missing owner.name");
  }
  if (!mp.metadata?.description) addError("CHK-001 marketplace.json is missing metadata.description");
  if (!SEMVER_RE.test(mp.metadata?.version ?? "")) {
    addError(`CHK-001 marketplace.json metadata.version "${mp.metadata?.version}" is not valid semver`);
  }
  if (!Array.isArray(mp.plugins)) addError("CHK-001 marketplace.json plugins is not an array");
};

const checkEntryNames = (entries) => {
  // CHK-002
  const seen = new Set();
  for (const entry of entries) {
    if (!PLUGIN_NAME_RE.test(entry.name ?? "")) {
      addError(`CHK-002 plugin name "${entry.name}" does not match ${PLUGIN_NAME_RE}`);
    }
    if (seen.has(entry.name)) addError(`CHK-002 duplicate plugin name "${entry.name}" in plugins array`);
    seen.add(entry.name);
  }
};

const checkSource = async (entry) => {
  // CHK-003
  const source = entry.source;
  if (typeof source !== "string" || !source.startsWith("./")) {
    addError(`CHK-003 ${entry.name}: source "${source}" must be a string starting with "./"`);
    return null;
  }
  if (source.split("/").includes("..")) {
    addError(`CHK-003 ${entry.name}: source "${source}" must not contain a ".." segment`);
    return null;
  }
  const dir = path.join(ROOT, source);
  const stat = await fs.lstat(dir).catch(() => null);
  if (!stat?.isDirectory()) {
    addError(`CHK-003 ${entry.name}: source "${source}" does not resolve to an existing directory`);
    return null;
  }
  if (stat.isSymbolicLink()) addError(`CHK-005 ${entry.name}: source "${source}" is a symlink (CON-005)`);
  return dir;
};

const checkPluginManifest = async (entry, dir) => {
  // CHK-004, CHK-005
  const manifestPath = path.join(dir, ".claude-plugin", "plugin.json");
  if (!(await exists(manifestPath))) {
    addError(`CHK-004 ${entry.name}: missing ${rel(manifestPath)}`);
    return null;
  }

  let manifest;
  try {
    manifest = await readJson(manifestPath);
  } catch (error) {
    addError(`CHK-004 ${entry.name}: ${rel(manifestPath)} is not valid JSON — ${error.message}`);
    return null;
  }

  const basename = path.basename(dir);
  if (manifest.name !== entry.name) {
    addError(`CHK-004 ${entry.name}: plugin.json name "${manifest.name}" does not match the marketplace entry name`);
  }
  if (manifest.name !== basename) {
    addError(`CHK-004 ${entry.name}: plugin.json name "${manifest.name}" does not match directory basename "${basename}"`);
  }

  if (!SEMVER_RE.test(entry.version ?? "")) {
    addError(`CHK-005 ${entry.name}: marketplace entry version "${entry.version}" is not valid semver`);
  }
  if (!SEMVER_RE.test(manifest.version ?? "")) {
    addError(`CHK-005 ${entry.name}: plugin.json version "${manifest.version}" is not valid semver`);
  }
  if (entry.version !== manifest.version) {
    addError(`CHK-005 ${entry.name}: version disagreement — marketplace "${entry.version}" vs plugin.json "${manifest.version}"`);
  }

  return manifest;
};

const checkOrphanDirectories = async (entries) => {
  // CHK-006
  const declared = new Set(entries.map((e) => path.basename(e.source ?? "")));
  const dirents = await fs.readdir(PLUGINS_DIR, { withFileTypes: true }).catch(() => []);
  for (const dirent of dirents) {
    if (dirent.isSymbolicLink()) {
      addError(`CHK-006 plugins/${dirent.name} is a symlink (CON-005)`);
      continue;
    }
    if (!dirent.isDirectory()) continue;
    if (!declared.has(dirent.name)) {
      addError(`CHK-006 plugins/${dirent.name} has no entry in marketplace.json (orphan directory)`);
    }
  }
};

const checkSkills = async (entry, dir, skillOwners) => {
  // CHK-007
  const skillsDir = path.join(dir, "skills");
  const dirents = await fs.readdir(skillsDir, { withFileTypes: true }).catch(() => null);
  if (!dirents) {
    addError(`CHK-007 ${entry.name}: missing skills/ directory`);
    return;
  }

  const skillDirs = dirents.filter((d) => d.isDirectory());
  if (skillDirs.length === 0) {
    addError(`CHK-007 ${entry.name}: skills/ contains no skill directories`);
    return;
  }

  for (const skillDir of skillDirs) {
    const skillPath = path.join(skillsDir, skillDir.name, "SKILL.md");
    if (!(await exists(skillPath))) {
      addError(`CHK-007 ${entry.name}: missing ${rel(skillPath)}`);
      continue;
    }

    const frontmatter = parseFrontmatter(await fs.readFile(skillPath, "utf8"));
    if (!frontmatter) {
      addError(`CHK-007 ${entry.name}: ${rel(skillPath)} has no YAML frontmatter`);
      continue;
    }
    if (!frontmatter.name) addError(`CHK-007 ${entry.name}: ${rel(skillPath)} frontmatter has no name`);
    if (!frontmatter.description) addError(`CHK-007 ${entry.name}: ${rel(skillPath)} frontmatter has no description`);
    if (frontmatter.name && frontmatter.name !== skillDir.name) {
      addError(
        `CHK-007 ${entry.name}: skill name "${frontmatter.name}" does not match its directory "${skillDir.name}" (CON-002)`,
      );
    }

    const owner = skillOwners.get(skillDir.name);
    if (owner) {
      addError(`CHK-007 skill directory "${skillDir.name}" is claimed by both "${owner}" and "${entry.name}"`);
    } else {
      skillOwners.set(skillDir.name, entry.name);
    }
  }
};

const checkDescriptions = (entry, manifest) => {
  // CHK-008
  if (!entry.description) addError(`CHK-008 ${entry.name}: marketplace entry description is empty`);
  if (!manifest?.description) addError(`CHK-008 ${entry.name}: plugin.json description is empty`);
  if (entry.description && entry.description.length > MAX_DESCRIPTION) {
    addError(`CHK-008 ${entry.name}: marketplace description is ${entry.description.length} chars (max ${MAX_DESCRIPTION})`);
  }
  if (manifest?.description && manifest.description.length > MAX_DESCRIPTION) {
    addError(`CHK-008 ${entry.name}: plugin.json description is ${manifest.description.length} chars (max ${MAX_DESCRIPTION})`);
  }
  if (entry.description && manifest?.description && entry.description !== manifest.description) {
    addError(`CHK-008 ${entry.name}: marketplace description and plugin.json description differ`);
  }
};

const checkReadme = async (entries) => {
  // CHK-009
  if (!(await exists(README))) {
    addError("CHK-009 README.md is missing");
    return;
  }
  const text = await fs.readFile(README, "utf8");
  const start = text.indexOf("<!-- CATALOG:START -->");
  const end = text.indexOf("<!-- CATALOG:END -->");
  if (start === -1 || end === -1) {
    addError("CHK-009 README.md is missing a catalog marker (<!-- CATALOG:START --> / <!-- CATALOG:END -->)");
    return;
  }
  if (end < start) {
    addError("CHK-009 README.md catalog markers are out of order");
    return;
  }

  const table = text.slice(start, end);
  for (const entry of entries) {
    const rows = table.split("\n").filter((line) => line.includes(`\`${entry.name}\``));
    if (rows.length === 0) addError(`CHK-009 README.md catalog has no row for "${entry.name}" — run node scripts/gen-readme.mjs`);
    if (rows.length > 1) addError(`CHK-009 README.md catalog has ${rows.length} rows for "${entry.name}"`);
  }

  const rowCount = table.split("\n").filter((line) => /^\|\s*\[?`/.test(line.trim())).length;
  if (rowCount !== entries.length) {
    addError(`CHK-009 README.md catalog has ${rowCount} rows but marketplace.json has ${entries.length} plugins`);
  }
};

const checkPrivacy = async () => {
  // CHK-010
  let stdout;
  try {
    ({ stdout } = await execFileAsync("git", ["ls-files", "-z"], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024 }));
  } catch (error) {
    addError(`CHK-010 could not list tracked files: ${error.message}`);
    return;
  }

  const files = stdout.split("\0").filter(Boolean);

  for (const file of files) {
    const buffer = await fs.readFile(path.join(ROOT, file)).catch(() => null);
    if (!buffer || buffer.includes(0)) continue; // unreadable or binary
    const text = buffer.toString("utf8");
    for (const needle of PRIVATE_STRINGS) {
      if (text.includes(needle)) addError(`CHK-010 ${file} contains the private string "${needle}" (SEC-001)`);
    }
  }
};

const main = async () => {
  let marketplace;
  try {
    marketplace = await readJson(MARKETPLACE);
  } catch (error) {
    addError(`CHK-001 could not read ${rel(MARKETPLACE)} — ${error.message}`);
    return report(0);
  }

  checkMarketplace(marketplace);

  const entries = Array.isArray(marketplace.plugins) ? marketplace.plugins : [];
  checkEntryNames(entries);

  const skillOwners = new Map();
  for (const entry of entries) {
    const dir = await checkSource(entry);
    if (!dir) continue;
    const manifest = await checkPluginManifest(entry, dir);
    checkDescriptions(entry, manifest);
    await checkSkills(entry, dir, skillOwners);
  }

  await checkOrphanDirectories(entries);
  await checkReadme(entries);
  await checkPrivacy();

  report(entries.length);
};

const report = (pluginCount) => {
  if (errors.length > 0) {
    for (const error of errors) console.error(`ERROR: ${error}`);
    console.error(`check-repo: ${errors.length} error(s)`);
    process.exitCode = 1;
    return;
  }
  console.log(`check-repo: OK (${pluginCount} plugins)`);
};

await main();
