# ARCHITECTURE.md

The architecture document for this repository, following the
[architecture.md](https://architecture.md) schema — built so an agent (or a
new colleague) can comprehend the codebase from this file alone, and so this
repository's own architectural principles are visible in how it actually
works. Fill every section; update it in the same change that alters the
architecture it describes.

This repository is a community plugin for the host vault application, not a
service: it runs inside the vault, reads and writes the vault's notes, and
keeps the vault's project management mirrored onto a code host and a personal
task manager.

## 1. Project Structure

Module-first, lowercase — the top level screams the domain. The architecture
axis is carried by file-name role suffixes (`Action`, `Adapter`, `Port`,
`Mapper`, `Data`, `Parser`), not layer folders. The composition root is
`src/main.ts` at the src root, above the modules. Tests mirror the tree.

```
obsidian-project-management/
├── src/
│   ├── core/         # the multi-adapter core: capability ports, canonical DTOs, the pure N-way merge, the adapter registrar, the mirror-sync action, the pass assembler
│   ├── infrastructure/ # driven adapters for the core, one namespace per vendor (the conformance fake, the vault origin + project-source adapters, the registry baseline store, and the GitHub and Todoist mirror adapters)
│   ├── app/          # driving side: plugin lifecycle, scheduler, queue, commands, modals, settings
│   ├── github/       # code-host provider: adapter, mapper
│   ├── todoist/      # task-manager provider DTOs and mapper
│   ├── vault/        # the vault adapter and the note mappers/parsers
│   ├── projects/     # discovery, attach, board creation
│   ├── registry/     # the data.json-backed SyncStatePort adapter and schema
│   ├── tasks/        # task actions: note creation, cascade
│   ├── todos/        # checklist ⇄ to-do note consistency
│   ├── sync/         # the chain, the probe, renames, deletion sweep
│   ├── shared/       # the kernel: ports, canonical DTOs, pure arithmetic — imports from no module
│   └── main.ts       # the composition root — wires every adapter and action
├── tests/            # mirrors src/
├── docs/             # developer manual — flows as sequence diagrams
├── scripts/          # esbuild bundle, eslint resolver, live probes
├── eslint.config.js  # boundary enforcement lives here (eslint-plugin-boundaries)
├── manifest.json     # the plugin manifest
└── package.json
```

**Where the logic lives.** A use case is an action: a class with one
meaningful responsibility, named `*Action`. Adapters map raw provider payloads
onto canonical DTOs at the boundary; the core never sees a provider shape.
Pure calculations live in `shared/` as one-function files or pure classes
(`hash`, `projectHomePath`). Delivery mechanics — the
scheduler, the queue, timers — belong to `app/` and make no business
decisions. Persistence is owned by the registry adapter; nothing else touches
`data.json`.

**The multi-adapter core.** `core/` is the inner block: the capability ports,
the canonical DTOs, the pure N-way merge, the adapter descriptor/registrar and
the generic mirror-sync action. `infrastructure/` holds the driven adapters
that implement those ports, one namespace per vendor. The composition root
wires them. The core runs unconditionally; the legacy halves, the old pure
verdict and the legacy writers are deleted.

**Growth rule.** Start flat; a folder appears when a second file of that role
or concept exists. Modules split when they outgrow grasp, not before.

## 2. High-Level System Diagram

The vault is the origin of truth. Project notes (a home note declaring a
non-empty `connections` map) and task/to-do notes are the system of record; the
code host (a repository plus a Projects v2 board) and the task manager are
mirrors the plugin keeps honest. A serialized sync pass reads
the vault, reconciles it against each mirror through a three-way diff, and
writes the winner back to whichever side is behind. The registry in `data.json`
is the memory that makes the diff possible: it holds each entity's identity and
each mirror's last-synced base.

```
                       the vault (origin of truth)
              project notes · task notes · to-do notes
                              │
                  ┌───────────┴────────────┐
                  │      the sync pass      │
                  │  probe → N-way merge →  │
                  │  fan-out                │
                  └──────┬──────────┬───────┘
                         │          │
              ┌──────────┘          └──────────┐
              ▼                                ▼
      code host (mirror)              task manager (mirror)
    repo + Projects board             projects · sections · tasks
              ▲                                ▲
              └──────────────┬─────────────────┘
                             │ identity + mirror base
                             ▼
                   registry in data.json
                        (the memory)
```

The pass is provider-neutral at its centre: the chain orchestrates the
per-connection mirror adapters through the core's ports, and the composition
root supplies the concrete provider actions. A provider's name never appears in
the chain.

## 3. Core Components

| Component             | Responsibility                                                                                                                                                                                                                                                                   | Technology                   | Target           |
| --------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | ---------------- |
| `src/main.ts`         | The composition root: plugin lifecycle, settings load, wiring, startup discovery and remote-project capture                                                                                                                                                                      | host plugin API              | the vault        |
| `src/app/`            | Driving side: `SyncScheduler` (delivery mechanics), `SyncQueue` (one serialized chain), settings tab and schema, the SecretStorage-backed token store, and the vault-artifact seed action                                                                                        | host plugin API, `Component` | the vault        |
| `src/sync/`           | The chain: `SyncProjectAction` runs the assembled core pass; the probe, rename recovery, frontmatter cleanup and deletion sweep                                                                                                                                                  | TypeScript                   | in-process       |
| `src/github/`         | The code-host provider: `GitHubAdapter`, `GithubTaskMapper`                                                                                                                                                                                                                      | GraphQL + REST               | the code host    |
| `src/todoist/`        | The task-manager provider's DTOs and mapper (the adapter and transport live under `infrastructure/todoist/`)                                                                                                                                                                     | REST v1                      | the task manager |
| `src/vault/`          | The origin adapter and the note mappers/parsers (`VaultAdapter`, `TaskNoteMapper`, `ToDoNoteMapper`/`Parser`, `CapturedTaskNoteMapper`, `Checklist`, the connections-block codec)                                                                                                | host vault API               | the vault        |
| `src/projects/`       | Project discovery, attach, board creation and the project mapper                                                                                                                                                                                                                 | TypeScript                   | in-process       |
| `src/registry/`       | The `SyncStatePort` adapter and its schema                                                                                                                                                                                                                                       | `data.json`                  | the vault        |
| `src/tasks/`          | Task actions: note creation and the completion cascade                                                                                                                                                                                                                           | TypeScript                   | in-process       |
| `src/todos/`          | Checklist ⇄ to-do note consistency in both directions                                                                                                                                                                                                                            | TypeScript                   | the vault        |
| `src/shared/`         | The kernel: the four ports, canonical DTOs and the pure helpers                                                                                                                                                                                                                  | TypeScript                   | in-process       |
| `src/core/`           | The multi-adapter core: the F01 capability vocabulary and ports, the canonical DTOs, the pure N-way merge, the adapter descriptor/registrar, the generic mirror-sync action, the baseline-store, project-source, mirror-handle and adapter-factory ports, and the pass assembler | TypeScript                   | in-process       |
| `src/infrastructure/` | Driven adapters for the core, one namespace per vendor — the in-memory conformance adapter, the vault origin and project-source adapters, the registry baseline store and mirror-handle adapter, and the GitHub and Todoist mirror adapters                                      | TypeScript                   | external tools   |

### Ports & adapters

The legacy chain still owns three provider-neutral ports, all in `src/shared/`.
Each states the **core need** it serves, never the tool's API it wraps; the
adapter registers from its own module.

- **`ProjectManagementPort`** — the remaining legacy code-host need: fetch a
  single issue, list and create a repository's labels, and delete a card / set
  an issue's state for the deletion sweep. The board identity, whole-project
  read, probe, capture and watch surfaces that once lived here have moved to the
  core's `ProjectSetupPort`, `ProjectCapturePort` and `ProjectActivityPort`.
  Adapter: `GitHubAdapter`.
- **`VaultPort`** — the origin's need: read, create, write and
  rename notes by path; move folders; enumerate notes under a folder; read a
  note's modified time; trash a note (never a permanent delete); enumerate the
  project notes; and subscribe to note change/delete/rename events. Adapter:
  `VaultAdapter`.
- **`SyncStatePort`** — the core's need for memory: one entity per hub and one
  base item per mirror, grouped under the port that owns it, plus identities,
  watch state, the per-project full-scan marker and the per-surface project
  cursors. Adapter: `SyncStateAdapter`.

A component that reaches around a port is a defect. The provider modules never
import each other; the provider modules meet only through `shared/` and `sync/`.

The API tokens are not settings and not a port: they live in Obsidian's
SecretStorage behind `SecretStorageAdapter` (`src/app/settings/`), which the
composition root reads at adapter construction and the settings tab sets and
clears. `data.json` is secret-free.

### The multi-adapter core (walking skeleton)

The `core/` block is the target shape of ADR-001, proven end to end on one thin
path (the `Status` field). It runs in the runtime unconditionally; the legacy
halves, the old pure verdict and the legacy writers are deleted. It consists of
the port layer and the pure core:

- **Capability ports (≤5), capability-grouped.** `ProjectPort` (`project`,
  `lifecycle`), `TaskSurfacePort` (`identity`, `title`, `body`, `subtasks`,
  `completion`, `Status`, `label`), and the optional `CapturePort`,
  `CompleteFetchPort`, `TimestampedPort`, `TaskLockPort` (`task-locking`) and
  `ProjectActivityPort` (`project-activity`). An adapter implements only the
  groups it declares; an undeclared optional port is absent, so a capability
  the adapter lacks has no interface to call. `TaskSurfacePort` carries one
  generic write entry, `applyField`, that dispatches a canonical field to the
  adapter's own representation; the completion fact is a separate canonical
  field from the `Status` representation.
- **Canonical DTOs.** `CanonicalTask`, `CanonicalProject`, `Baseline`,
  `SideObservation`, `OriginObservation`, `Delta` and `MergeResult` — one
  canonical shape per concept, owned by the core. The merge diffs canonical
  fields only.
- **The pure N-way merge** (`mergeField`). Sides plus exactly one origin role;
  a delta per side against its own baseline; the F02 ladder (decisive
  timestamp → completion over a stale open → origin tie-break); delete proof (a
  verified-complete fetch plus a synced baseline); the origin's absence as a
  delete delta (NWM-27); the origin's edit time trusted by default (NWM-28).
  No I/O, no clocks.
- **The descriptor and registrar.** Each adapter exports a typed descriptor
  (application id, capabilities, per-field representations, secret keys,
  settings rows). The composition root assembles a plain list and passes it to
  the pure `registerAdapters`, which validates per F01 (known capabilities, all
  required fields, the in-scope minimum surface, a unique lowercase application
  id) and returns the accepted adapters as a map, each exposing only the ports
  its descriptor declares.
- **The generic mirror-sync action** (`MirrorSyncAction`). It names no
  provider: it collects each capable mirror's observation against its own
  baseline, calls the single merge, and fans the reconciled value out through
  the one generic write entry. It also writes the reconciled value back to the
  origin (or trashes the note on a delete), and advances the baseline of every
  side written or already matching — a skipped write advances too; a failed
  write advances nothing (NWM-17). A mirror write that throws is recorded on the
  pass record's failed sides and fan-out continues to the remaining mirrors, so
  one failing connection never abandons the rest.
- **The origin port** (`OriginPort`). The core's need for the origin: observe a
  note's field as a canonical value plus its edit time, trusted by default
  (NWM-28); apply a canonical field write to the note; trash the note (never a
  permanent delete). It is separate from the capability ports: the origin is a
  role, not an application, and gets no descriptor.
- **The origin/mirror model.** The vault is the origin — a side distinguished
  by its role, supplying the tie-break, its edit time trusted, its absence a
  delete — and needs no descriptor. A connection produces a mirror side. The
  vault adapter and the application adapters are structural peers under
  `infrastructure/`.
- **The vault origin adapter** (`infrastructure/vault/VaultOriginAdapter`)
  implements `OriginPort` over the host vault API: it reads a task note into
  the canonical fields, writes a reconciled value back, and trashes the note.
  It is an infrastructure peer, not a capability adapter.
- **The baseline store port** (`BaselineStorePort`). The core's need to read and
  write one side's baseline for an entity + field — the memory the merge diffs
  against. Its adapter (`infrastructure/registry/CoreBaselineStoreAdapter`)
  persists to `data.json` under a top-level `coreBaselines` key — a sibling of
  `syncState`, as the settings root writes use — leaving the existing chain's
  per-mirror bases untouched.
- **The project source port** (`ProjectSourcePort`). The core's need to read a
  project's declared connections as `{application, target}` envelopes and to
  enumerate the project's task notes. Its adapter
  (`infrastructure/vault/VaultProjectSourceAdapter`) discovers the home note
  name-agnostically through the vault's project-note scan — the same discovery
  the legacy chain and the lifecycle adapter use — so an unmigrated legacy-named
  home note still scopes its mirrors, and reuses the legacy vault module's
  connections codec and note reads.
- **The pass assembler** (`AssembleProjectPassAction`). Given a project, it
  reads each declared connection with its slug, builds the connection's mirror
  adapter through the factory (scoped by the connection's target), resolves the
  entity to that connection's own handle through the mirror-handle port,
  assembles the origin side through `OriginPort` and each mirror's baseline
  through the baseline store, runs `MirrorSyncAction` once per (entity,
  canonical value field) against a per-connection `MirrorSide`, and persists the
  advanced baselines. The project source enumerates note paths, so a mirror side
  is keyed `mirror:<slug>` — disjoint from the origin side's `origin` key, so a
  connection slug of `origin` cannot collide — while the origin keeps the note
  path as its handle. Two connections to the same application stay distinct
  sides. A connection whose entity has no resolved handle is materialized: the
  origin task is read through `OriginPort.readTask` (a note without a `type` is
  not a task and is skipped), a placeholder handle is recorded through the
  mirror-handle port before the item is created through
  `TaskSurfacePort.createTask`, the real handle replaces the placeholder, and
  the created mirror is reconciled in the same pass. A placeholder left by an
  interrupted pass is adopted by matching the mirror's task title rather than
  re-created, so a failed record never duplicates the item; a connection whose
  entity has no origin task is skipped.
- **The mirror-handle port** (`MirrorHandlePort`). The core's need to resolve a
  note path to the handle a given connection's application uses for it (an issue
  URL, a task id), and to record a handle it just materialized. Its adapter
  (`infrastructure/registry/RegistryMirrorHandleAdapter`) first maps the note
  path to the registry entity's id (`findByNotePath`), then reads that entity's
  per-connection item through the existing `findMirrorItemByEntity` lookup; on
  record it reuses the note path's entity or creates one, removes any handle
  already recorded for that entity, then stamps the per-connection item through
  `setMirrorItem`.
- **The mirror-project port** (`MirrorProjectPort`). The core's need to resolve
  and record the handle a connection's application uses for the mirror project
  (a board, a project id). Its adapter
  (`infrastructure/registry/RegistryMirrorProjectAdapter`) stores the handle in
  the existing per-connection port state, preserving the rest of the
  bookkeeping. A connection with no recorded handle and no readable mirror
  project is onboarded: the lifecycle pass creates it through
  `ProjectPort.createProject`, records the returned handle, and reconciles it in
  the same pass rather than skipping it.
- **The project-setup port** (`ProjectSetupPort`). The core's need to resolve a
  connection's project before it mirrors: the projects a target carries, one
  created or adopted with the core's Status vocabulary, the addressing the core
  writes through, the projects the viewer can see, and a cheap per-project state
  probe. The code-host adapter implements it; the discovery, attach,
  board-ensure and probe setup actions depend on this port, not on the legacy
  `ProjectManagementPort`.
- **The project lifecycle reconciliation** (`ProjectLifecycleSyncAction` +
  `AssembleProjectLifecyclePassAction`). The project-level peer of the
  mirror-sync action: it resolves each connection's mirror project through
  `MirrorProjectPort`, onboarding a missing one via `ProjectPort.createProject`
  so a newly-connected project is onboarded in the same pass, then reads the
  origin's archived state through `ProjectLifecycleOriginPort` and each
  mirror's through `ProjectPort`, runs the same pure `mergeField` ladder over
  the archived fact, and fans the reconciled freeze out to the origin and every
  capable mirror. Any side can start the freeze or the unfreeze (NWM-15); the
  reconciled freeze is the pass's `frozen` verdict, which gates the task-field
  pass (NWM-16). Its per-side baselines live
  in the same `coreBaselines` store under the `lifecycle` field. The archived
  fact carries a timestamp: the origin's is the home note's edit time, trusted
  by default (NWM-28), and each mirror's is read through `ProjectPort`'s
  `archivedTime` — a provider that exposes none returns null, so the ladder
  falls through to the vault tie-break. The origin adapter
  (`infrastructure/vault/VaultProjectLifecycleAdapter`) discovers the home note
  name-agnostically — the same discovery the legacy chain uses, so an
  unmigrated note is never misread as archived — moves the project folder on a
  freeze/unfreeze, and relocates the registry's entity paths in lockstep. The
  pass also renames a mirror project whose name drifted from the vault project
  through `ProjectPort.renameProject`.
- **The task-lock port** (`TaskLockPort`) and the task-lock action
  (`ReconcileProjectTaskLocksAction`). The core's need to close a task's
  conversation while its project is frozen and reopen it on unfreeze; the code
  host declares `task-locking` and the task manager does not. On a lifecycle
  transition the action enumerates the project's tracked mirror items through
  the mirror-handle port, skips the tasks whose vault status is the done lane,
  and locks the rest — or unlocks every tracked task on the unfreeze. The
  lifecycle record carries the prior frozen state so the transition is known.
- **The project-activity port** (`ProjectActivityPort`) and the reactivation
  action (`ReactivateFrozenProjectAction`). The core's need to notice that new
  work appeared on a frozen project's mirror; the code host declares
  `project-activity`. The action runs before the lifecycle pass: when the origin
  was already frozen and the mirror's newest item provably postdates the stored
  watch cursor, it unfreezes the origin, so the lifecycle pass fans the unfreeze
  out to every mirror. The first watch adopts the newest item as the cursor; a
  quiet conditional read writes nothing. The watch state (`ProjectWatchPort` +
  `infrastructure/registry/CoreProjectWatchAdapter`) is per project and
  connection, persisted under a top-level `coreWatches` key.
- **The mirror-adapter factory port** (`MirrorAdapterFactoryPort`). The core's
  need to build a mirror adapter for an application and a connection target. The
  composition root implements it over the provider adapters, so one adapter
  instance serves exactly one connection. Its optional `captureSources` exposes
  the capture-capable adapters, built once at the composition root and gated by
  the `capture` capability.
- **The project-capture surface** (`ProjectCapturePort` +
  `CaptureProjectsAction`). A capture-capable adapter enumerates the
  application-born projects it can see (`captureProjects`), each carrying its
  name, its candidate connection targets and its creation clock. The core action
  reads each source's projects in creation order, adopts every project after
  that source's stored cursor that the vault does not already declare — writing
  the home note with its connection envelope through the vault capture adapter,
  which reuses the legacy home-note path and connections codec — and advances
  the cursor only over the projects it handled. A first sight adopts the newest
  clock and captures nothing; a project that links zero or several targets stops
  the watermark with a collected error. An already-declared project is never
  re-created, so the pass is idempotent. The cursor store and the vault sink are
  infrastructure peers; the core names no provider.
- **The task-capture surface** (`CapturePort` + `CaptureTasksAction`). For each
  declared connection whose adapter declares `capture`, the core action reads the
  tracked tasks the adapter can see (`capture`) — the issues carrying a type
  label — and adopts every task the vault does not already hold as a task note.
  The whole listing is scanned each pass and the adopted mirror items are
  skipped, so the pass is idempotent without a cursor and a task ordered before
  an adopted one is still adopted; a connection whose listing or adoption fails
  is collected and never stops the later connections. The vault sink routes by
  the connection's application — the code-host task note or the captured draft
  note — and refuses an empty handle, so a malformed task never stamps a blank
  mirror. The vault sink is an infrastructure peer; the core names no provider.
- **The cutover.** `SyncProjectAction` requires the five reconciler providers.
  It runs the reactivation action before the assembled lifecycle pass
  (unfreezing the origin when newer mirror work appears), the assembled
  lifecycle pass for the freeze verdict, the task-lock action on the
  freeze/unfreeze transition, the assembled task capture for tracked tasks, and
  the assembled pass for task-field reconciliation, and migrates the
  project's home note through the legacy migration action. Probe, board-ensure,
  vault consistency and the deletion sweep still run — the sweep now enumerates
  the project's code-host connections directly — and the capture pre-tick runs
  the assembled core capture. The legacy lifecycle, remote-capture and
  archive-lock actions the new core supersedes are deleted; the old-port
  consumers that remain are the handle-deleted action.
- **The conformance adapter** (`infrastructure/fake/`) is an in-memory adapter
  registered at the composition root. It is inert unless a project names its
  application id, so the plugin behaves exactly as before.
- **Connection validation is open.** A connection is accepted when it names a
  registered application; the composition root supplies the registered set from
  the adapters it registers, so the accepted set is not a hardcoded union. An
  application that is not registered is still rejected with a collected error.
- **The infrastructure adapters.** `infrastructure/` is the driven-adapter
  block: one namespace per application (`infrastructure/<vendor>/`), each
  carrying the provider's own vocabulary, its transport boundary, its opaque
  target and its descriptor. The conformance adapter is the reference
  implementation; a real mirror adapter is a new namespace beside it, with no
  core edit. `infrastructure/` imports `core/` only, and the
  provider-vocabulary gate keeps each namespace the sole home for its
  provider's name.
- **The GitHub mirror adapter** (`infrastructure/github/`) implements the
  capability ports for the code host: title and body as the issue, Status as the
  board card's lane, completion as the issue state (kept separate from the
  lane), subtasks as the sub-issue relation, label as the issue labels, and the
  project, capture, complete-fetch and per-field-timestamp surfaces. Its
  descriptor registers under the application id `github`. It is wired at the
  composition root; the legacy GitHub half is deleted.
- **The Todoist mirror adapter** (`infrastructure/todoist/`) implements the
  capability ports for the task manager: title as the task content, body as the
  task description, Status as the project section, completion as the task's
  completed fact, subtasks as the parent relation, label as the task labels, and
  the project, capture, complete-fetch and per-field-timestamp surfaces. Its
  descriptor registers under the application id `todoist`. It is wired at the
  composition root; the legacy Todoist half is deleted.

## 4. Data Stores

- **The vault** — the system of record; markdown notes, not a database.
  Project notes live under `Projecten/<name>/` (or `Archief/` when archived)
  and declare their tool connections in a non-empty `connections` map; task
  notes under `taken/`; to-do notes under `todos/`. Identity is a
  vault-owned uuid held in the registry — filenames and frontmatter carry no
  machine id.
- **`data.json`** — the plugin's data file and the registry. One `syncState`
  container (schema version 3) holding `entities` (uuid → note path),
  `projects.<name>.ports.<connectionSlug>.items.<handle>` (each mirror's
  last-synced base, a diff view whose body is a digest), `ports` (provider,
  project, last poll, lane names), per-connection identities
  (`projects.<name>.identities.<connectionSlug>`), watch state, the
  per-project `fullScanPending` marker, and the per-surface `projectCursors`.
  Ports are keyed by the note's connection slug, so a project can hold two
  connections of the same tool; a slug rename re-keys the port in lockstep.
  Written only through `SyncStateAdapter`, behind a serialization mutex it
  shares with the settings save. A top-level `coreBaselines` key — a sibling
  of `syncState`, like the settings root writes — holds the new core's
  per-side, per-entity, per-field baselines, separate from the existing
  chain's `items.<handle>.base`, so a registry write cannot clobber it. A
  sibling `coreWatches` key holds the new core's per-project, per-connection
  reactivation watch (the conditional read's etag and its newest-item cursor),
  separate from the legacy chain's per-project watch state.
- **`main.js`** — the built bundle; never authored.

No other persistent store. The mirrors hold copies, never authority.

## 5. External Integrations / APIs

- **Code host** — GraphQL for the whole-project read (issues plus board
  cards), issue creation and the board operations; REST for the conditional
  watch read (ETag / 304) and the label and state updates. The core consumes it
  through the capability ports (`ProjectPort`, `TaskSurfacePort`,
  `ProjectSetupPort`, `ProjectCapturePort`, `ProjectActivityPort`); the legacy
  deletion surfaces still ride `ProjectManagementPort`. A
  fine-grained token, bearer.
- **Task manager** — REST v1 for projects, sections, tasks and labels. The core
  consumes it through the capability ports (`ProjectPort`, `TaskSurfacePort`,
  `CapturePort`). An API token, bearer.
- **The host vault application** — the plugin API (vault read/write, events,
  `requestUrl`, settings and data). Behind `VaultPort`; only the adapter
  imports the host package.

There is no server of our own: every call goes through the host's `requestUrl`
over HTTPS.

## 6. Deployment & Infrastructure

- **Distribution** — a community plugin. `pnpm run build` bundles `src/` with
  esbuild to `main.js` (beside `manifest.json`), copied into a vault's
  `.obsidian/plugins/project-management/` and enabled under Community plugins.
- **CI/CD** — GitHub Actions: a dedicated release workflow (conventional
  commits → semver → bare-version tag carrying `manifest.json` and `main.js`,
  the shape Obsidian's plugin review requires) plus automatic-updates,
  inherited from the shared starters; there is no server-side deploy.
- **Monitoring/logging** — none remote. The plugin logs through the host
  console; a corrupt `data.json` is quarantined rather than silently reset.

## 7. Security Considerations

- **Credentials** — the code-host and task-manager tokens live in Obsidian's
  SecretStorage behind `SecretStorageAdapter`, never in `data.json` and never in
  the repository. The composition root reads them at adapter construction; the
  settings tab sets and clears them. `.env` files are ignored.
- **Transport** — every request is HTTPS through the host's `requestUrl`. The
  adapters are token-agnostic; the composition root injects the bearer header.
- **Least privilege** — the code-host token needs only Issues and Projects
  read/write; the task-manager token only its own data.
- **No runtime attack surface** — the plugin runs inside the vault's sandbox;
  no server, no inbound port.

## 8. Development & Testing Environment

- **Local setup** — the `devshell` submodule (`devshell-node`) via `.envrc` →
  `use flake ./devshell`; `direnv allow`, then `pnpm install`.
- **Build** — `pnpm run build` (esbuild bundle) or `pnpm run dev` (watch).
- **Testing** — Vitest (`pnpm test`, `pnpm run test:watch`); tests mirror
  `src/`.
- **Code quality** — TypeScript strict (`pnpm run typecheck`), ESLint flat
  config with prettier (`pnpm run lint`), prettier (`pnpm run format:check`).
- **Mechanical gates** (and what each makes impossible):
  - **`eslint-plugin-boundaries`** — the module dependency matrix. Elements
    are the `src/` module folders plus the src root (the composition root);
    `core/` is the inner block and imports no module; `infrastructure/` may
    import `core/` only, with two transitional, file-scoped exceptions — the
    vault project-source adapter reuses the legacy `vault/` connections codec
    and note reads, and the shared `projectHomePath` convention, while the old
    chain is retired; `shared/` imports from no module; provider modules
    never import each other; neutral modules consume the kernel and the ports
    that live in it, never a provider adapter directly; the composition root
    wires everything. An unlisted import edge fails the lint, so the dependency
    graph stays acyclic and the inner blocks stay neutral.
  - **`boundaries/no-unknown-files`** and **`no-unknown-dependencies`** —
    every source file must belong to an element and every local import must
    resolve to one, so a new top-level module (including `core/` and
    `infrastructure/`) cannot slip in unclassified.
  - **`pnpm run lint:boundaries`** (`scripts/lint-boundaries.mjs`) — the
    provider-vocabulary gate. A provider name may appear only in the provider's
    own module (`github/`, `todoist/`, `infrastructure/<vendor>/`), the
    composition root (`main.ts`) and the driving side (`app/`); a capitalized
    provider name anywhere else fails. Inside the neutral architecture
    (`core/`, `infrastructure/`) the check is case-insensitive, so any provider
    name in the core fails. The gate is bite-tested
    (`tests/scripts/lint-boundaries.test.ts`): a deliberate core violation exits
    non-zero while the legitimate provider path exits zero, so a green gate on
    an empty tree cannot pass unnoticed. The legacy chain predates the core and
    its pre-existing provider vocabulary is grandfathered until that chain is
    retired.
  - **`pnpm run typecheck`** — strict tsc; a class of runtime bugs becomes a
    compile error.
  - **`pnpm test`** — behavioral tests per module, including the core pass
    assembler's integration tests.

## 9. Future Considerations / Roadmap

**Deliberate non-goals:**

- **No second provider wired.** The ports are provider-neutral, so a second
  code host or task manager is a matter of implementing the port — but only
  one provider per port is wired today. The ports keep that door open; they do
  not justify a speculative adapter.
- **No conflict UI.** A two-sided field conflict is resolved by rule, not by a
  person. The decision ladder's decisive-timestamp, semantic and
  origin-authority rungs always produce a verdict, so no field is ever left
  for a human to arbitrate. A conflict dialog was excluded on purpose.
- **No server or database.** The registry is the plugin's own `data.json`; the
  vault is the system of record. There is no backend.
- **No permanent deletion.** A deleted note's echoes are removed from the
  mirrors, but the vault note itself is trashed, never destroyed.

**Known debt / open items:** `ProjectManagementPort` still carries the
deletion surfaces — `fetchBoardItems`, `fetchTask`, `deleteCard` and
`setTaskState` — kept for the handle-deleted action until they migrate to the
core ports. Its label surface (`listRepoLabels`, `createRepoLabel`) has no
consumer since project seeding was dropped. The discovery, attach, board-ensure
and probe setup actions now run on the core's `ProjectSetupPort`; the new
lifecycle pass, capture and locking reconcilers run unconditionally, and the
legacy remote-capture, archive-lock and lifecycle actions are deleted along
with `TaskManagerPort` and the legacy `TodoistAdapter` (its transport moved to
`infrastructure/todoist/`). The remaining old-port consumer is the
handle-deleted action. The legacy chain carries pre-existing provider
vocabulary (`shared/`, `projects/`, `sync/`, `tasks/`, `vault/`, `registry/`,
`todoist/`); the provider-vocabulary gate grandfathers it until that chain is
retired. The developer manual records the remaining code-vs-brief
discrepancies.

The multi-adapter core (`core/` + `infrastructure/`) is a walking skeleton:
the shape is built and proven on the `Status` field through the conformance
adapter, GitHub and Todoist mirror adapters implement the capability ports, the
vault origin adapter completes the origin round-trip, and the pass assembler
plus the core baseline store assemble a whole project pass and persist its
baselines. Project lifecycle (archive/unarchive) reconciles through the same
core: the lifecycle pass assembler reads the origin's and each mirror's
archived state, runs the same N-way ladder, and fans the freeze out. The
lifecycle bookkeeping that surrounded the legacy freeze also moved onto the new
path: a drifted mirror project is renamed, a frozen project's unfinished task
conversations are locked (and unlocked on unfreeze), and a frozen project
reactivates when newer mirror work appears. The runtime cutover is
unconditional: the chain builds the origin and the per-connection mirror
adapters from the project's connections and the stored secrets, runs the
reactivation action, the assembled lifecycle pass for the freeze verdict, the
task-lock action and the assembled pass for task-field reconciliation. The
legacy halves, the old pure verdict and the legacy writers are deleted.

## 10. Project Identification

Project Name: obsidian-project-management

Repository URL: https://github.com/99linesofcode/obsidian-project-management

Primary Contact/Team: Jordy Schreuders (99linesofcode)

Date of Last Update: 2026-10-09

## 11. Glossary / Acronyms

- **Vault** — the markdown note store the plugin runs inside; the origin of
  truth.
- **Mirror** — a copy of the vault's content on a remote (the code host or the
  task manager). A mirror is never authoritative.
- **Hub / entity** — one vault-owned thing (a task or to-do note) carrying a
  uuid; mirrors are its leaves.
- **Port** — a provider-neutral interface the core owns, stating the core's
  need; an adapter implements it.
- **Base** — the last-synced snapshot of a mirror, stored in the registry; the
  third side of the three-way diff.
- **Diff view** — the comparable form of a task: the body replaced by its
  digest, so hashing is stable across formatting.
- **Decision ladder** — the ordered rules that resolve a field conflict:
  decisive timestamp, then the semantic rule, then origin authority.
- **Reopen veto** — the guard that stops a pull from reverting a completion on
  a stale board lane.
- **Lane** — a board column / task-manager section.
- **Outward materialization** — creating a mirror for a vault-born task,
  registry-first: the task-field pass records a placeholder handle before it
  creates the missing item through the adapter, stamps the real handle over the
  placeholder, and reconciles it in the same pass; an interrupted pass adopts
  the created item instead of duplicating it.
- **Capture** — adopting a remote-born project or tracked task into the vault. A
  project capture is guarded by a per-surface creation watermark; a task capture
  scans the whole application listing for the tracked tasks (those carrying a
  type label) and skips the mirror items already stamped, so it needs no cursor.
  A captured project's home note is born with the connection
  envelope: a task-manager-born project declares a todoist connection, a
  board-born project a github connection derived from the board's single linked
  repository. Zero or several linked repositories is a collected error, never a
  silent capture; the home note declares only the connection envelope. A captured
  task is born as a task note — a code-host issue through the task-note writer, a
  task-manager task as a captured draft — and its mirror item is stamped so it is
  never re-created.

## 12. Conventions & Boundaries

The house standards this repository adheres to — stated here in full.
Enforced by `eslint-plugin-boundaries` (elements = the module folders) and the
`lint:boundaries` vocabulary grep:

- **Folder structure**: module-first, lowercase; the path locates the module,
  the name locates the role.
- **File naming**: PascalCase classes with role suffixes (`*Action`,
  `*Adapter`, `*Port`, `*Mapper`, `*Data`, `*Parser`); camelCase pure
  functions, one per file (`hash.ts`, `projectHomePath.ts`). Tests
  mirror the tree: `tests/<module>/…`.
- **Entry point**: `src/main.ts` — above the modules, never inside one; the
  composition root.
- **Dependency matrix**: `core/` imports no module; `infrastructure/` imports
  `core/` only; `shared/` imports from no module; the provider modules
  (`github`, `todoist`) never import each other; neutral modules consume the
  kernel and the ports that live in it, never a provider adapter directly; the
  composition root wires everything; no circular module dependencies.
- **Provider neutrality**: provider names appear only in the provider's own
  module (the legacy `github/`/`todoist/` and the `infrastructure/<vendor>/`
  adapters), the composition root, and the driving side; shared and
  cross-cutting vocabulary is neutral (a provider name is a value argument,
  never a namespace key). The neutral architecture (`core/`, `infrastructure/`)
  is checked case-insensitively, so any provider name in the core fails.
  Enforced by `lint:boundaries`; the legacy chain's pre-existing vocabulary is
  grandfathered until it is retired.
- **Canonical DTOs**: one canonical shape per domain concept, owned by the
  core; diff/merge logic operates on canonical fields only. A DTO mimicking a
  provider's structure is a provider shape, whatever its file name.
- **The vault wins**: a field changed on both sides resolves by origin
  authority; only a remote field time that provably postdates every local edit
  overrides it.
- **Base advances only after durable writes**: a mirror's base is stored after
  its write lands; a failed write advances nothing.
- **Documentation surfaces**: WHY comments at the change site; the developer
  manual (`docs/developer-manual.md`) updated when a flow changes.
