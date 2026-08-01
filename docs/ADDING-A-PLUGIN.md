# Maintaining the catalog

`.claude-plugin/marketplace.json` is the single source of truth. The README table, the
consistency checker, and the version bumper all derive from it.

Skills are grouped into themed plugins (`pr`, `plan`, `writing`, `frontend`) because installed
skills are addressed as `plugin:skill`. The group carries the object, so skill names stay short
verbs — `pr:local-review`, `plan:execute` — and a plugin never shares a name with a skill inside
it (`humanize` lives in `writing`, not in a plugin called `humanize`). Prefer adding a skill to
an existing group over creating a new plugin.

## Adding a skill to an existing plugin

1. Copy the skill in, including any `references/` or `scripts/` directories:

   ```bash
   mkdir -p plugins/<group>/skills/<skill>
   cp -a <source>/<skill>/. plugins/<group>/skills/<skill>/
   ```

   The directory name must equal the `name:` in the `SKILL.md` frontmatter, and no two plugins
   may claim the same skill name.

2. If the group now covers something its description doesn't mention, update it in
   `plugin.json` **and** the marketplace entry — they must match byte for byte, ≤ 400 chars.

3. Add a `` ### `<group>:<skill>` `` section to the plugin README.

4. Release:

   ```bash
   npm run bump -- <group> minor
   npm test && node scripts/gen-readme.mjs
   git add -A && git commit && git push
   ```

## Adding a plugin

Pick a group name that will never equal a skill name inside it.

1. Create `plugins/<group>/` with the skill(s) as above.
2. `plugins/<group>/.claude-plugin/plugin.json`:

   ```json
   {
     "name": "<group>",
     "version": "1.0.0",
     "description": "Use when …",
     "author": { "name": "João Vogler", "url": "https://github.com/jv-vogler" },
     "homepage": "https://github.com/jv-vogler/skills",
     "repository": "https://github.com/jv-vogler/skills",
     "license": "MIT",
     "keywords": ["kebab-case", "tags"],
     "skills": "./skills/"
   }
   ```

3. `plugins/<group>/README.md`: H1, one-line summary, `## Skills` with one section per skill,
   install line.
4. Marketplace entry (alphabetical by `name`; `source` must start `./`, no `..`):

   ```json
   {
     "name": "<group>",
     "source": "./plugins/<group>",
     "description": "<same as plugin.json>",
     "version": "1.0.0",
     "category": "developer-tools",
     "keywords": ["<same as plugin.json>"]
   }
   ```

5. Bump `metadata.version`, then `npm test && node scripts/gen-readme.mjs`, commit, push.

## Removing

- **A skill**: `git rm -r plugins/<group>/skills/<skill>`, remove its README section,
  `npm run bump -- <group> minor`.
- **A plugin**: `git rm -r plugins/<group>`, delete its marketplace entry, bump
  `metadata.version`.

Then `npm test && node scripts/gen-readme.mjs`, commit, push. Existing installs keep their
copy until `/plugin marketplace update jv-vogler`.

## Renaming

Renames break existing installs.

- **A plugin**: add `"renames": { "<old>": "<new>" }` at the top level of `marketplace.json`
  so installs migrate. Then `git mv plugins/<old> plugins/<new>`, update `name` in
  `plugin.json`, `name` + `source` in the entry, and the README headings. Bump minor.
- **A skill**: no migration path — treat as remove + add. `git mv` the directory, update the
  frontmatter `name:` to match, grep for `<group>:<old>` references. Bump minor.

## Releasing

```bash
npm run bump -- <group> <major|minor|patch>   # syncs plugin.json, entry, metadata.version
npm test && node scripts/gen-readme.mjs

claude plugin tag plugins/<group> --push -m "<group> v%s"   # per-plugin tag <group>--v<X.Y.Z>
git tag -a v<metadata.version> -m "marketplace v<metadata.version>"   # marketplace tag
git push origin v<metadata.version>
```

## Gates

`npm test` = `claude plugin validate . --strict` (schema) + `node scripts/check-repo.mjs`
(name/directory agreement, version agreement, orphans, description identity, README freshness,
private-string scan). CI runs both on every push and PR.
