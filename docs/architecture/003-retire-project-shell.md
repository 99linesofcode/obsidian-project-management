# ADR 003 — Retire the vault-maintenance shell

- **Status:** accepted
- **Date:** 2026-10-10

## Context

ADR 001 decided the multi-adapter core and deliberately **retained** a
vault-maintenance shell around it: the legacy chain was not fully replaced, so
the surrounding steps (home-note migration, connection re-keying, board-ensure,
rename recovery, vault consistency and the deletion sweep) lived in a
`ProjectShell` class the chain drove. `ARCHITECTURE.md` §9 named that shell as
the repository's main debt, and the developer manual recorded it as the one
code-vs-brief discrepancy.

`ProjectShell` was a god-object: eight collaborators bundled behind six methods,
mutable error state (`stepErrors`, `reset()`, `errors`), and two of its own
dependencies (`MigrateProjectHomeNoteAction`, `SweepDeletedNotesAction`)
constructed inside its constructor rather than injected — an
inversion-of-control violation. It also duplicated the chain's own
error-isolation helper (`step()`).

## Decision

**The chain owns the sequence; there is no shell.** `ProjectShell` is deleted.
`SyncProjectAction` drives every step — the vault-maintenance steps and the core
reconcilers — in the same order, through one private `step()` helper and one
error list. Every collaborator, including `MigrateProjectHomeNoteAction` and
`SweepDeletedNotesAction`, is injected at the composition root (`main.ts`).

The behaviour is unchanged: the same steps in the same order, the same per-step
failure isolation, the same lifecycle fallback (a lifecycle failure logs and
does not count as a step error). The one accepted, unasserted change is error
_ordering_: errors now accumulate in execution order rather than "all
maintenance errors, then all reconciler errors". The consumer (`SyncQueue`)
reads only `errors.length`.

## Consequences

- The god-object and its mutable state are gone; the chain is the single
  orchestrator of the pass, and its collaborators are visible in its
  constructor.
- The duplicated error-isolation helper collapses to one `step()`.
- The hidden `new` is gone; the composition root wires every action.
- `ARCHITECTURE.md` §9's debt item is dropped and the developer manual's
  code-vs-brief discrepancy #1 is resolved.
- **Accepted cost:** `SyncProjectAction` grows to eleven collaborators and
  ~230 lines. It is an orchestrator with no business rules — it sequences steps
  and isolates their failures — so the size is cohesion, not a new god object;
  the steps themselves remain one-action-per-concern.
