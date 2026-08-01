---
name: execute
description: Execute an implementation plan written by `plan:write` — one named phase, a bounded span of phases, or the whole plan. Use whenever the user asks to execute, implement, continue, or resume a plan or its phases — "run phase 2", "continue the plan", "implement the next phase", "run the whole plan", "go up to phase 4", "execute feature-auth-module-1.md" — or references a plan file in `/plan/`. Runs each phase's tasks under the code writing standards, marks tasks complete in the plan file as they land, and commits the work on a branch the user chose.
---

# Execute Implementation Plan

Execute an implementation plan produced by `plan:write`. The plan is the source of truth: follow
it literally, and keep it updated so anyone — human or agent — can read the file and know exactly
where the work stands.

Phases run sequentially in the current session. They are ordered because they depend on each
other, so later phases benefit from the context the earlier ones built — do not farm them out to
independent agents.

## Workflow

### 1. Locate and verify the plan

Find the plan file in `/plan/` (the user may name it; otherwise pick the file matching the work
described). Verify it follows the `plan:write` template:

- Front matter with `goal` and `status`
- `## 2. Implementation Steps` containing `### Implementation Phase N` sections
- Each phase has a `GOAL-NNN` and a task table with `Task | Description | Completed | Date` columns

If no plan exists or the file doesn't match this structure, stop — do not improvise a plan or
execute from an unstructured document. Tell the user and offer to write one with `plan:write`
first.

### 2. Resolve scope

Read the request for one of four forms, and state which one you resolved before starting:

- **Named phase** — "run phase 2", "phase 3 only" → that phase alone.
- **Bounded run** — "phases 2 through 4", "up to phase 3", "stop at phase 5" → that span in
  order, inclusive of the named end phase. An open start ("up to N") begins at the first phase
  with incomplete tasks.
- **Whole plan** — "the whole plan", "all phases", "finish it" → every phase with incomplete
  tasks, in order.
- **Nothing stated** → the first phase with incomplete tasks, then stop.

If a phase earlier than the resolved start has incomplete tasks, surface that before starting:
phases are ordered for a reason, and building on unfinished groundwork usually produces rework.

Multi-phase runs repeat steps 4–6 per phase and report after each one completes. Halt
immediately on an unmet `GOAL` or a failing `TEST-` item — leave the plan file accurate, and say
which phase stopped and why. Never skip past a failing phase to reach a later one.

### 3. Choose the branch

Before touching code, ask the user whether to create a new branch for the work or continue on the
current one — suggest a name derived from the plan, like `feature-cart-discounts-phase-1` for a
single phase or `feature-cart-discounts` for a multi-phase run. Ask once for the whole run, not
per phase. When running unattended with no stated preference, stay on the current branch and say
so in the report. If the working tree already holds unrelated uncommitted changes, surface them
before starting: the commits should contain only the plan's work.

### 4. Execute the tasks

Work through the phase's tasks in order, honoring any dependencies the plan declares. Task
descriptions are deterministic on purpose — follow the file paths, names, and details as written.
While writing code, obey the plan's requirements (`REQ-`), constraints (`CON-`), guidelines
(`GUD-`), and patterns (`PAT-`), plus the Code Writing Standards below.

Verify the phase's `GOAL` is actually met before calling it done — run the plan's relevant
`TEST-` items and any completion criteria the phase defines.

### 5. Mark progress in the plan file

As each task completes, update its row: `✅` in Completed, today's date in Date. Update per task,
not in a batch at the end — an interrupted run must leave the plan accurate.

When work starts, set front matter `status` to `In progress` (badge color `yellow`); when the
plan's final task completes, set it to `Completed` (badge color `brightgreen`). Keep the status
badge in the Introduction in sync and refresh `last_updated`.

### 6. Commit the phase

Once the phase's goal is verified, commit its work in atomic commits: each commit is one logical
change that builds and passes tests on its own. A small, cohesive phase is usually a single
commit; a phase that mixes concerns (a refactor enabling a feature, code plus docs) gets one
commit per concern. Never bundle unrelated changes into one commit, and never split one logical
change across several.

Match the repository's existing commit message convention (check `git log`); absent one, default
to Conventional Commits — `type(scope): summary` — choosing the type that matches the change:
`feat`, `fix`, `refactor`, `test`, `docs`, `chore`. In the phase's final commit, reference the
plan and phase — e.g. `feat(cart): add discount module (feature-cart-discounts-1, phase 1)` — and
include the updated plan file, so the recorded progress and the work share the same history.

In a multi-phase run, commit each phase before starting the next. An interrupted run then leaves
completed phases in history and the plan file agreeing with them.

### 7. Report

After each phase: the tasks completed, tests run and their results, the branch and commits
produced, and which phase is next. Keep it short enough to skim between phases.

After the last phase of a multi-phase run, add a closing summary: phases completed, phases still
incomplete and why, and the full commit range.

## Code Writing Standards

Apply these to every line of code written while executing a phase. To extend this list, add a new
`###` subsection: a named rule, the instruction, and a one-line reason.

### Names spell out meaning

No abbreviations or single-letter names — `qty`, `amt`, `cfg` make the reader decode instead of
read. The only exceptions are near-universal conventions: loop indices `i`/`j`, comparators
`a`/`b`, math `x`/`y`, caught errors `e`/`err`, event `e`, and infra names `id`, `db`, `ctx`.

### Return early

Prefer guard clauses over nested conditionals and keep cyclomatic complexity low — the happy path
should read top-to-bottom without indentation debt. Never nest ternaries; a ternary that needs
another ternary needs a function.

### Comments explain why, never what

Make code self-explanatory by extracting well-named functions and variables instead of annotating
opaque blocks. Reserve comments for context the code cannot carry: a constraint, a workaround, a
non-obvious "why".

### No magic numbers

Move literal values and configuration into named constants, enums, or config objects. A name
documents intent; a bare number forces every reader to reverse-engineer it.

### Pure by default

Favor pure functions and determinism; avoid mutating values and hidden side effects. When side
effects are necessary, isolate them in the layer that owns them (IO, infrastructure) so core logic
stays predictable and testable.
