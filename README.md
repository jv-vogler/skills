# jv-vogler skills

Personal Claude Code skills, grouped into themed plugins.

## Install

```
/plugin marketplace add jv-vogler/skills
/plugin install <plugin>@jv-vogler
```

Non-interactive:

```bash
claude plugin marketplace add jv-vogler/skills
claude plugin install <plugin>@jv-vogler
```

## Catalog

<!-- CATALOG:START -->

| Plugin | Version | Category | What it does |
| ------ | ------- | -------- | ------------ |
| [`code`](./plugins/code) | 1.0.0 | developer-tools | Use when writing or landing code — implementing a feature, fixing a bug, refactoring, or migrating. `code:implement` carries the standard for how code gets written (naming… |
| [`frontend`](./plugins/frontend) | 1.0.0 | developer-tools | Use when adding or changing a feature, page, API call, hook, form, or component in a React or Next.js app laid out as infrastructure + domain + view + routes; when deciding which… |
| [`plan`](./plugins/plan) | 1.1.0 | developer-tools | Use when planning a new feature, refactor, package upgrade, migration, or design, architecture, or infrastructure change — and when executing the resulting plan. `plan:write`… |
| [`pr`](./plugins/pr) | 1.0.0 | developer-tools | Use when working a pull request end to end: reviewing a diff locally for real bugs and design problems without posting anything to GitHub, and writing a PR description that… |
| [`writing`](./plugins/writing) | 1.0.0 | productivity | Use when editing or reviewing prose to strip the signs of AI-generated writing and make it read as human-written. Based on Wikipedia's "Signs of AI writing" guide: inflated… |

<!-- CATALOG:END -->

## Updating

Refresh the catalog, then update each plugin. Restart to apply.

```
/plugin marketplace update jv-vogler
/plugin update <plugin>@jv-vogler
```

## Contributing

See [docs/ADDING-A-PLUGIN.md](docs/ADDING-A-PLUGIN.md).

## License

[MIT](LICENSE)
