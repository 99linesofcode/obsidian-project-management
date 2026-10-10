# ADR 004 — Module-first tree: the repo is the module, no component wrapper

- **Status:** accepted
- **Date:** 2026-10-10
- **Supersedes:** ADR 002

## Context

ADR 002 settled the architecture-first tree: one component, three layers at the
`src` root (`app/`, `domain/`, `infrastructure/`). It read the house skill's
"concept → architecture → role" as describing the _interior_ of a bounded
context, and so put the layers at the root with no component wrapper.

The `software-architecture` skill has since been rewritten **module-first and
fractal**: the top-level unit is the module (a repository is a module), its
interior is `ui/` (driving adapters), `core/` (the hexagon) and `infrastructure/`
(driven adapters), and `core` holds the components. The rewritten skill's base
case still said a single-bounded-context module names its one component ("name
it anyway") — but that is the older rule, and it contradicts the skill's own
boundary rule (_the application's subject is not a component_): a component
called `project-management` inside a repo called `obsidian-project-management`
names the app's own subject.

## Decision

**The repository is the module; its interior is the layers.** The tree is
`src/ui/`, `src/core/`, `src/infrastructure/`, with the composition root at
`src/main.ts` — above the layers.

**No component wrapper for a single bounded context.** OPM is one bounded
context, so `core` holds `application/`, `domain/` and `port/` directly. There
is no `core/<component>/` folder: the component's layers sit at `core`'s root.
A module that wraps several bounded contexts grows `core/<component>/…` per
component; a single-context module does not.

**The skill is corrected in the same change.** The `software-architecture`
base-case paragraph and role-menu table are edited to state the no-wrapper rule
for a single-context module, so architecture stays single-sourced.

**Placement.** Ports at `core/port/`; DTOs at `core/application/data/`; the
reconciler interfaces and their aggregate at `core/application/services/`; the
domain error at `core/domain/errors/`; the neutral note arithmetic at
`core/domain/`. The settings shape the core consumes
(`ProjectManagementSettings`) lives in `core/application/data/`, so the seed
action and the settings UI both depend inward.

## Consequences

- Supersedes ADR 002.
- The ESLint boundary elements and the provider-vocabulary gate follow the new
  layers: `core`, `ui`, the two provider namespaces, `infrastructure`.
- Behaviour is unchanged: every move, rename and relocation is mechanical, and
  the 77-file / 495-test suite is the characterization net.
