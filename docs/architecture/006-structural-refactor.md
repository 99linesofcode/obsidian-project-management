# ADR 006 — Structural refactor: three collaborator ports, a folded chain, no descriptor

- **Status:** accepted
- **Date:** 2026-10-12
- **Supersedes:** ADR 001's port topology (option 1A)
- **Amends:** ADR 004 (the reconciler-interface placement)

## Context

ADR 001 decided a multi-adapter core as `1A + 2A + 3A`: capability-grouped
narrow ports (≤5, one per merge surface), a descriptor/registrar registration
seam, and one capability-parameterized mirror-sync action over a pure N-way
merge. ADR 002–005 then settled the tree, retired the vault-maintenance shell,
and replaced the descriptor/registrar with a plain provider table.

What shipped, by contrast, was more machinery than the core needed:

- **A facet-port layer.** The vault, the registry and each external tool were
  split across many narrow ports — the mirror's project, task, capture,
  timestamp, locking and setup surfaces; the vault's origin, project-source,
  lifecycle and capture facets; the registry's baseline, handle, project,
  identity and connection-state facets — each served by a thin wrapper adapter.
  A caller had to compose facets that were one collaborator.
- **The descriptor/registrar.** `AdapterDescriptor` / `AdapterRegistration` /
  `registerAdapters` validated a capability vocabulary no port gate consumed
  (ADR 005 deleted it).
- **A reconciler layer.** Five reconciler interfaces and their aggregate sat
  between the chain and the core actions; the chain also threaded pass records
  to report each reconciler's result.
- **Retired behaviour.** An activity-watch reactivation silently unfroze a
  project when new remote work appeared; a per-surface capture cursor/watermark
  gated adoption of remote-born work.
- **A dead canonical hash layer** (`snapshotHash`, the canonical digest,
  `MirrorItem.base`) that nothing read.

The provider-neutral merge, the canonical DTOs and the ladder were sound; the
machinery around them was ceremony.

## Decision

**Collapse the machinery onto the collaborators and the merge; keep the
behaviour.**

- **Three collaborator ports, two factory seams.** One port per collaborator:
  `MirrorPort` (the external tool, with the optional surfaces as optional
  methods a caller presence-checks), `VaultPort` (the vault as the origin and
  project source) and `RegistryPort` (the sync state). The factory seams that
  are real core needs — `MirrorAdapterFactoryPort` (build a connection's
  adapter, enumerate capture sources) and `ProjectSetupFactoryPort` (reach a
  tool's setup surface) — stay beside them. The facet ports and their wrapper
  adapters are deleted; each adapter implements its one port.
- **One provider table, no descriptor.** Restated from ADR 005: the composition
  root holds one plain `providers` table and derives the factory, the setup
  factory, the registered-application set and the token settings from it.
- **The chain is the orchestrator.** The five reconciler interfaces and their
  aggregate are deleted; `SyncProjectAction` drives the vault-maintenance steps
  and the core actions directly, and the core actions report their results
  directly. No pass-record layer.
- **Reactivation is retired.** A frozen project no longer unfreezes because
  newer remote activity appeared. Archive is one N-way lifecycle merge over the
  `archived` fact: any side may archive or un-archive, and the reconciled
  verdict fans out to every side (ADR 004's tree, the merge ladder unchanged).
- **The capture cursor is retired.** Capture is idempotent by name+connection;
  the first run against an account adopts the whole back-catalogue, and a second
  pass skips what the vault already holds.
- **The intra-core seam is gated.** `core/` is split into `domain/`,
  `application/` and `port/` as separate `eslint-plugin-boundaries` elements —
  `domain` imports nothing, `port` references the domain only, `application`
  imports the domain and the ports — so the neutral core cannot invert. The
  merge vocabulary moves into `domain/`, beside `mergeField`.

## Consequences

- **The core talks to three collaborators, not a facet fan-out.** A new adapter
  implements one port and adds one provider-table entry; the kernel is not
  edited.
- **The chain reads as one sequence.** `SyncProjectAction` sequences the steps
  and isolates each failure; the reconciler and pass-record indirection is gone.
- **The registry and vault are one boundary each.** Vault I/O and the registry
  persist as boundaries; the thin wrapper adapters between them and the core are
  deleted.
- **Behaviour is preserved, minus the retired machinery.** The N-way ladder,
  the canonical DTOs, materialization, the deletion sweep, the checklist
  round-trip and the lifecycle fan-out are unchanged; the reactivation watch and
  the capture cursor are removed by decision.
- **Enforced by:** the boundary gate (`eslint-plugin-boundaries`, with the core
  split into its three layers), the provider-vocabulary gate
  (`scripts/lint-boundaries.mjs`) and the naming gate
  (`scripts/lint-naming.mjs`) — the same gates ADR 001 named, now covering the
  intra-core seam.
- **Deleted by this decision:** the facet ports and their wrapper adapters; the
  five reconciler interfaces and their aggregate; the pass records; the
  activity-watch reactivation; the capture cursor; the canonical hash layer
  (`snapshotHash`, the digest, `MirrorItem.base`).
- **Accepted cost:** a large mechanical refactor across `src/` and `tests/`,
  with `ARCHITECTURE.md`, the developer manual and this ADR set updated in the
  same change.
