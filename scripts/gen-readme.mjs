#!/usr/bin/env node
// Regenerates the README catalog table from .claude-plugin/marketplace.json,
// which is the single source of truth for the plugin list (CON-004).
//
// Usage: node scripts/gen-readme.mjs

import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const ROOT = path.resolve(import.meta.dirname, "..");
const MARKETPLACE = path.join(ROOT, ".claude-plugin", "marketplace.json");
const README = path.join(ROOT, "README.md");

const START = "<!-- CATALOG:START -->";
const END = "<!-- CATALOG:END -->";
const SUMMARY_LIMIT = 180;

const fail = (message) => {
  console.error(`ERROR: ${message}`);
  process.exit(1);
};

/** Table cells need one line; full descriptions live in each plugin's README. */
const summarize = (description) => {
  const flat = description.replace(/\s+/g, " ").replace(/\|/g, "\\|").trim();
  if (flat.length <= SUMMARY_LIMIT) return flat;
  const cut = flat.slice(0, SUMMARY_LIMIT);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > 0 ? lastSpace : SUMMARY_LIMIT).replace(/[,;:.\s]+$/, "")}…`;
};

const renderTable = (plugins) => {
  const rows = [...plugins]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (p) =>
        `| [\`${p.name}\`](./plugins/${p.name}) | ${p.version} | ${p.category ?? "—"} | ${summarize(p.description)} |`,
    );

  return [
    "| Plugin | Version | Category | What it does |",
    "| ------ | ------- | -------- | ------------ |",
    ...rows,
  ].join("\n");
};

const marketplace = JSON.parse(await fs.readFile(MARKETPLACE, "utf8"));
const readme = await fs.readFile(README, "utf8").catch(() => fail("README.md not found"));

const start = readme.indexOf(START);
const end = readme.indexOf(END);
if (start === -1 || end === -1) fail("markers not found");
if (end < start) fail("markers out of order");

const next =
  readme.slice(0, start + START.length) +
  "\n\n" +
  renderTable(marketplace.plugins) +
  "\n\n" +
  readme.slice(end);

if (next === readme) {
  console.log(`gen-readme: up to date (${marketplace.plugins.length} plugins)`);
} else {
  await fs.writeFile(README, next);
  console.log(`gen-readme: wrote ${marketplace.plugins.length} rows to README.md`);
}
