# plan

Implementation planning before code, and disciplined execution after.

## Skills

### `plan:write`

Produces a structured plan file in `/plan/` — phased tasks, explicit requirements, rejected
alternatives, tests — that an agent or a person can execute without re-deriving the approach. For
new features, refactors, upgrades, migrations, and design, architecture, or infrastructure
changes.

### `plan:execute`

Executes a plan written by `plan:write`. Resolves scope from the request — one named phase, a
bounded span (`up to phase 3`), or the whole plan — then verifies the plan's structure, asks once
whether the work goes on a new branch or the current one, works through each phase's tasks under
a set of code writing standards, marks tasks complete in the plan file as they land, and commits
each phase as a single reviewable unit. Halts on the first unmet goal or failing test.

## Install

```
/plugin install plan@jv-vogler
```
