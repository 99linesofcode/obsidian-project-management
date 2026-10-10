# ADR 001 — Multi-adapter core: capability ports, descriptor registration, one N-way merge

- **Status:** accepted
- **Date:** 2026-10-08

## Context

The specs `F01` (adapter capability model & registration) and `F02` (N-way
reconciliation) define the behaviour the core must have to support an arbitrary
number of connected applications. The current code cannot carry it:

- Two provider-shaped ports in the kernel: `ProjectManagementPort` (really a
  code-host port — repository, Projects-v2 board, issue) and `TaskManagerPort`.
- A closed application list in the kernel (`shared/ConnectionTools.ts`).
- A chain that classifies halves by a `requiresBoard` boolean and branches on
  `tool === 'github'`; a composition root whose half-factory is a closed `if/if`.
- One adapter per port threaded through the composition root
  (`ReconcileProjectLifecycleAction(github, todoist, …)`).
- A pairwise pure core (`Reconciliation` / `VerdictResolver`).

The house contract is Explicit Architecture (Graça): package by component, ports
designed for the core's needs, a provider-neutral vocabulary, and mechanical
boundary enforcement. The current `src/` tree (module-first by tool/concern) is
not authoritative.

## Options

Full analysis in `planning/opm-multi-adapter/options.md`. In brief:

1. **Port topology** — 1A capability-grouped narrow ports; 1B one fat port with
   optional methods; 1C one interface per capability.
2. **Registration** — 2A descriptor exports assembled at the composition root
   with a neutral pure registrar; 2B a mutable registry; 2C declarative
   manifests.
3. **Sync topology** — 3A one capability-parameterized mirror-sync action plus
   one pure N-way merge; 3B per-capability steps; 3C a three-phase
   collect/merge/fan-out chain.

## Decision

**1A + 2A + 3A**, owner-approved 2026-10-08.

- **Port topology — 1A.** Capability-grouped narrow ports (≤5), grouped by the
  surface the merge consumes. A capability an adapter lacks has no interface to
  call, so "declared-only surfaces" is structural, not a runtime guard.
- **Registration — 2A.** Each adapter module exports a typed descriptor
  (application id, capabilities, per-field representations, secret keys,
  settings rows). The composition root assembles the descriptor list and passes
  it to a neutral, pure registrar that validates and returns a map. The kernel
  is not edited to add an application.
- **Sync topology — 3A.** One generic mirror-sync action parameterized by the
  declared capabilities, plus one pure N-way merge in the core. The action
  collects each side's deltas against that side's baseline and calls the single
  merge; the merge is a pure calculation over canonical DTOs.

**Decomposition — a single core component.** The application's subject
("mirror the vault's project management onto external applications") is not a
component; there are no distinct bounded contexts underneath it. The shape is
the three blocks plus the port layer:

- driving side — the Obsidian-facing surface: commands, modals, settings,
  scheduler;
- core — actions, the capability ports, the canonical DTOs, the enums, and the
  pure N-way merge;
- driven adapters — one per vendor (GitHub, Todoist, the Obsidian vault, the
  data-file registry), under an infrastructure namespace;
- `main.ts` — the composition root.

No shared kernel: there is nothing to share across components that do not exist.
The exact folder tree is finalised by the walking skeleton and recorded in
`ARCHITECTURE.md`.

**Placement.** The capability vocabulary and canonical DTOs live with the core;
the capability ports live in the core's port layer; the pure merge is a core
calculation; the adapters live under infrastructure, one namespace per vendor.
"`shared/` holds interfaces only" is dropped as a constraint.

**The origin is a role, not a special case.** The merge operates uniformly over
sides; exactly one side is the origin. The vault adapter — a driven adapter, a
structural peer of the application adapters, implementing the origin port — is
that side: it supplies the tie-break value, its edit time is trusted by default,
and its absence of an entity is a delete delta. A connection produces a mirror
side. The vault gets no application descriptor: its descriptor would be vacuous
(no secret, no settings, identity mappings for every field), and its note-I/O
port does not fit the capability-method shape. The vault adapter sits under
infrastructure beside the application adapters.

## Consequences

- **Enforced by:** the boundary gate — `eslint-plugin-boundaries` (element
  matrix; no outer-block import into an inner block; `no-unknown-files` classifies
  every module) plus the provider-vocabulary gate
  (`scripts/lint-boundaries.mjs`, bite-tested in
  `tests/scripts/lint-boundaries.test.ts`). A provider name is allowed only in
  the provider's own module (`github/`, `todoist/`, `infrastructure/<vendor>/`)
  and the composition root (`main.ts`). Everywhere else it fails: the neutral
  architecture (`core/`, `infrastructure/`) is checked case-insensitively, the
  rest for any capitalized or upper-case form. The gate, not prose, is what
  keeps the structure from drifting.
- **Deleted by this decision:** `shared/ConnectionTools.ts` (the closed
  application union), the `requiresBoard` boolean, the `tool === 'github'`
  branches, and the closed half-factory.
- **Accepted cost:** a one-line composition-root edit per adapter (the intended
  registration seam); a large refactor of the sync chain; and the first real
  adapter becomes the integration test, since a fake conformance adapter is the
  only proof built now.
- **Validated by:** the mirror-port-sufficiency spike (2026-10-08) — the port
  set carries 1A+3A and generalises to N=3 with differing capabilities (31
  cases green; strict `tsc` clean). Three constraints it surfaced, to fold into
  the port set:
  - the task write surface needs one generic entry (a canonical-field → write
    dispatch) so subtasks and completion fan out through the single action,
    rather than one method per canonical field;
  - the canonical mirror shape must keep the completion fact separate from the
    Status representation — the GitHub reopen veto compares a mirror's own state
    against its lane, so collapsing them into one field loses the distinction;
  - F02 now states the vault's timestamp trust (`NWM-28`): the vault's edit time
    is trusted by default; a mirror must declare it.
