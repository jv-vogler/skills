---
name: execute
description: Execute an implementation plan written by `plan:write` — one named phase, a bounded span of phases, or the whole plan. Use whenever the user asks to execute, implement, continue, or resume a plan or its phases — "run phase 2", "continue the plan", "implement the next phase", "run the whole plan", "go up to phase 4", "execute feature-auth-module-1.md" — or references a plan file in `/plan/`. Runs each phase's tasks under `code:implement`, marks tasks complete in the plan file as they land, and commits each phase on a branch the user chose.
---

# Execute Implementation Plan

Execute an implementation plan produced by `plan:write`. The plan is the source of truth: follow
it literally, and keep it updated so anyone — human or agent — can read the file and know exactly
where the work stands.

Code is written and committed under `code:implement` — its standards, verification, branch, and
commit rules apply throughout. This skill adds only what the plan contributes: which phase runs,
what its tasks say, and keeping the file honest about progress.

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

Follow `code:implement`'s branch step, suggesting a name derived from the plan —
`feature-cart-discounts-phase-1` for a single phase, `feature-cart-discounts` for a multi-phase
run. Ask once for the whole run, not per phase.

### 4. Execute the tasks

Work through the phase's tasks in order, honoring any dependencies the plan declares. Task
descriptions are deterministic on purpose — follow the file paths, names, and details as written.
While writing code, obey the plan's requirements (`REQ-`), constraints (`CON-`), guidelines
(`GUD-`), and patterns (`PAT-`) on top of `code:implement`'s standards. Where the plan and the
standards conflict, the plan wins — it was written for this codebase.

Verify the phase's `GOAL` is actually met before calling it done — run the plan's relevant
`TEST-` items and any completion criteria the phase defines, alongside the project's own tests
and checks.

### 5. Mark progress in the plan file

As each task completes, update its row: `✅` in Completed, today's date in Date. Update per task,
not in a batch at the end — an interrupted run must leave the plan accurate.

When work starts, set front matter `status` to `In progress` (badge color `yellow`); when the
plan's final task completes, set it to `Completed` (badge color `brightgreen`). Keep the status
badge in the Introduction in sync and refresh `last_updated`.

### 6. Commit the phase

Once the phase's goal is verified, commit its work as `code:implement` describes — atomic
commits, the repository's message convention. A phase is a commit boundary, not necessarily a
single commit: one that mixes concerns still gets one commit per concern.

In the phase's final commit, reference the plan and phase — e.g. `feat(cart): add discount module
(feature-cart-discounts-1, phase 1)` — and include the updated plan file, so the recorded
progress and the work share the same history.

In a multi-phase run, commit each phase before starting the next. An interrupted run then leaves
completed phases in history and the plan file agreeing with them.

### 7. Report

After each phase: the tasks completed, tests run and their results, the branch and commits
produced, and which phase is next. Keep it short enough to skim between phases.

After the last phase of a multi-phase run, add a closing summary: phases completed, phases still
incomplete and why, and the full commit range.
