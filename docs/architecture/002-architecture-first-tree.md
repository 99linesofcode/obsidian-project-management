# ADR 002 — Architecture-first tree: one component, three layers at the root

- **Status:** accepted
- **Date:** 2026-10-10

## Context

ADR 001 decided the multi-adapter core: a single core component (the
application's subject is not a component), the three blocks — driving, core,
driven — plus the composition root, and no shared kernel. It also said the
exact folder tree would be "finalised by the walking skeleton."

The implementation kept six pre-refactor concept modules — `projects/`,
`sync/`, `tasks/`, `todos/`, `vault/`, `registry/` — as top-level _siblings_
of the three blocks. The result is two organising axes at the top level at
once: architecture layers (`core/`, `infrastructure/`, `app/`) and business
concepts. The same concept even lives on both axes — `vault/` beside
`infrastructure/vault/`, and `registry/` beside `infrastructure/registry/` —
so a reader has no single answer to "where does the vault live." It is
neither concept-first nor cleanly layer-first.

The house `software-architecture` skill prescribes concept → architecture →
role: components at the top, layers inside each. That describes the
_interior_ of a bounded context (in Laravel, the inside of one package); it
is silent on how several packages are assembled at a repo root. Graça's
Explicit Architecture shows the assembly (`Core`/`Infrastructure`/
`Presentation`) with components _inside_ `Core`. The apparent conflict
between the skill and the reference is only apparent: they describe different
levels.

OPM is a single bounded context. There are no distinct sub-contexts: the
pieces (`projects`, `tasks`, `todos`, `sync`) share the canonical task/project
model and the one `mergeField`. So the skill's interior shape applies at the
repo root — the repository _is_ the one component.

## Decision

**Architecture-first, at the root.** `src/{app,domain,infrastructure}` plus
`src/main.ts` (the composition root). `core/` is renamed `domain/` — `Domain`
names the layer, where Graça's `Core` names the container (components + ports

- shared kernel), so `core/` would re-import the ambiguity this ADR removes.

The six concept modules are dissolved into the layers:

- `projects/`, `sync/`, `tasks/`, `todos/` are use cases → `domain/` (actions
  into `domain/actions/`).
- The pure note arithmetic in `vault/` (`splitFrontmatter`, `withBody`,
  `ToDoNoteParser`, `ToDoNoteMapper`, `folderChainForPath`, …) → `domain/`.
  It is neutral note arithmetic the core must own — the same reason
  `Checklist` already lives in the core.
- `vault/VaultAdapter` — the only `vault/` file that touches the Obsidian API
  — → `infrastructure/vault/`, beside the origin and capture adapters.
- `registry/` → `infrastructure/registry/`, beside the core-registry adapters.

Role folders inside `domain/`: `actions/`, `ports/`, `data/` (all canonical
and shell DTOs in one place), with pure single-function files loose at
`domain/`'s root.

## Consequences

- **The boundary element set shrinks** to `app`, `domain`, `infrastructure`,
  and the two provider namespaces (`github`, `todoist`) that must stay
  isolated from each other and from the neutral `infrastructure` block. The
  matrix becomes: `domain` imports no module; every adapter and `app` import
  `domain`; the provider namespaces import `domain` only; `app` additionally
  reaches `infrastructure` for the storage key it shares with the registry
  adapter.
- **The vault split is what keeps the dependency rule clean.** `tasks/` and
  `todos/` already import the note arithmetic; once it is in `domain/`, those
  edges are domain-internal instead of concept-module-to-concept-module.
- **The provider-vocabulary gate** drops the dissolved paths from its neutral
  set; `domain/` replaces `core/` as the inner neutral block.
- **Accepted cost:** a large mechanical move (every `src/` and `tests/` path
  under the dissolved modules), with the boundary config, the vocabulary
  gate, `ARCHITECTURE.md` and the developer manual updated in the same change.
- **Follow-ups (not this ADR):** collapse the 29-port layer (ADR 001 decided
  ≤5 capability-grouped ports), normalise the class-vs-function split, and
  retire the retained `ProjectShell` (the debt `ARCHITECTURE.md` already
  flags).
