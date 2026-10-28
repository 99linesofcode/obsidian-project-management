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
task manager. The vault is the origin of truth; every remote is a mirror.

## 1. Project Structure

Module-first (ADR 004). The repository _is_ the module — the single bounded
context that mirrors the vault's project management onto external applications
— so its interior is the layers: `ui/` (driving adapters), `core/` (the
hexagon) and `infrastructure/` (driven adapters). OPM is one bounded context,
so `core` holds `application/`, `domain/` and `port/` directly, with no
`core/<component>/` wrapper. The architecture axis is carried by the folder;
the role axis by file-name suffixes (`Action`, `Port`, `Adapter`,
`DataTransferObject`, `Mapper`, `Parser`). The composition root is
`src/main.ts`, above the layers. Tests mirror the tree.

```
obsidian-project-management/
├── src/
│   ├── ui/              # driving adapters: settings/ (tab, schema,
│   │                    # secret-storage), sync/ (scheduler, queue)
│   ├── core/            # the module's hexagon
│   │   ├── application/ # use cases (actions/), DTOs (data/)
│   │   ├── domain/      # the neutral note arithmetic and the domain error
│   │   │                # (errors/)
│   │   └── port/        # the collaborator and factory ports
│   ├── infrastructure/  # driven adapters, one namespace per vendor:
│   │                    # vault/ (the single VaultAdapter + note codecs),
│   │                    # github/ (mirror adapter, transport, wire vocabulary),
│   │                    # todoist/ (mirror adapter + transport),
│   │                    # registry/ (the data.json-backed registry),
│   │                    # fake/ (in-memory conformance test double)
│   └── main.ts          # the composition root — wires every adapter and action
├── tests/               # mirrors src/
├── docs/                # developer manual — flows as sequence diagrams; ADRs
├── scripts/             # esbuild bundle, the provider-vocabulary + naming gates
├── eslint.config.js     # boundary enforcement lives here (eslint-plugin-boundaries)
├── manifest.json        # the plugin manifest
└── package.json
```

**Where the logic lives.** A use case is an action: a class with one
meaningful responsibility, named `*Action`. Adapters map raw provider payloads
onto canonical DTOs at the boundary; the core never sees a provider shape.
Pure calculations live in cohesive lowercase modules, grouped by subject
(`note`, `paths`, `affiliation`; the merge's `mergeField` and `sides`).
Delivery mechanics — the scheduler, the queue,
timers — belong to `ui/` and make no business decisions. Persistence is owned
by the registry adapter; nothing else touches `data.json`.

**The core.** `core/` is the module's hexagon. `application/` holds the use
cases (`actions/`), the application shapes (`data/`) and the shared services
(`services/` — connection validation and the merge-pass driver); `domain/` holds
the neutral note arithmetic, the merge
vocabulary (`mergeField` and its shapes — `Delta`, `MergeResult`,
`SideObservation`, `Baseline`, `OriginObservation`) and the domain error
(`errors/`); `port/` holds the ports and the canonical DTOs they carry
(`port/data/`). It names no provider. The three layers are gated separately —
`domain/` imports nothing outward, `application/` may use `domain/` and `port/`,
and `port/` may reference `domain/` only (its payloads live with the port) — so
a domain or port file that reaches outward fails the lint. `infrastructure/`
holds the driven adapters that implement those ports, one namespace per vendor.
The composition root wires them. The old provider halves, the pairwise verdict
and the legacy writers are deleted; the chain drives the vault-maintenance steps
(connection origination, rename recovery, vault consistency, deletion sweep)
directly, documented in the developer manual.

**Growth rule.** Start flat; a folder appears when a second file of that role
or concept exists. A consumer folder appears when an action has exclusive
collaborators (`create-task-note/`, `sync-checklist/`). Modules split when
they outgrow grasp, not before.

## 2. High-Level System Diagram

The vault is the origin of truth. Project notes (a home note declaring a
non-empty `connections` map) and task/to-do notes are the system of record; the
code host (a repository plus a Projects v2 board) and the task manager are
mirrors the plugin keeps honest. A serialized sync pass reads the vault,
reconciles it against each mirror through one pure N-way merge, and writes the
winner back to whichever side is behind. The registry in `data.json` is the
memory that makes the merge possible: it holds each entity's identity and each
mirror's last-synced baseline (the core's
`coreBaselines`).

```
                       the vault (origin of truth)
              project notes · task notes · to-do notes
                              │
                  ┌───────────┴────────────┐
                  │      the sync pass      │
                  │  N-way merge → fan-out  │
                  └──────┬──────────┬───────┘
                         │          │
              ┌──────────┘          └──────────┐
              ▼                                ▼
      code host (mirror)              task manager (mirror)
    repo + Projects board             projects · sections · tasks
              ▲                                ▲
              └──────────────┬─────────────────┘
                             │ identity + baseline
                             ▼
                   registry in data.json
                        (the memory)
```

The pass is provider-neutral at its centre: the core reconciles canonical fields
across the origin and each connection's mirror adapter through the core's ports,
and the composition root supplies the concrete provider adapters. A provider's
name never appears in the core.

The per-project pass runs the same sequence every tick; the developer manual
carries a sequence diagram per path. The central flow:

```mermaid
sequenceDiagram
  participant Sched as SyncScheduler
  participant Q as SyncQueue
  participant SP as SyncProjectAction
  participant V as VaultPort
  participant Life as ProjectLifecycleSyncAction
  participant Lock as ReconcileProjectTaskLocksAction
  participant TF as MirrorSyncAction
  participant MP as MergePassService
  participant M as MirrorPort

  Sched->>Q: enqueue(project) per project note
  Q->>SP: execute(project)
  SP->>V: findProjectNotes (no-op when missing)
  SP->>SP: migrate home note, rekey connections, resolve-or-create connections
  SP->>Life: invoke(project)
  alt project folder gone
    Life->>M: delete the remote project on every connection
  else
    Life->>M: resolve each connection's mirror project
    alt remote project absent
      Life->>Life: leave the connection unoriginated
    else
      Life->>MP: reconcile(archived)
      MP->>M: observe, fan out
      MP->>V: apply to the origin
    end
  end
  SP->>Lock: invoke({ project, frozen, wasFrozen })
  SP->>SP: renames, checklist, mirror to-do
  alt not frozen
    SP->>SP: task capture (link on title match, else adopt; kind by label or position)
    SP->>TF: invoke(project)
    TF->>MP: reconcile(each canonical field)
    MP->>M: observe, fan out
    MP->>V: apply to the origin
  end
  SP->>SP: deletion sweep (record tombstones, reconcile, prune)
```

## 3. Core Components

| Component             | Responsibility                                                                                                                                                                                                                | Technology                   | Target         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------- |
| `src/main.ts`         | The composition root: plugin lifecycle, settings load, wiring and the per-pass connection origination                                                                                                                         | host plugin API              | the vault      |
| `src/ui/`             | Driving side: `SyncScheduler` (delivery mechanics), `SyncQueue` (one serialized chain), the settings tab and schema, the SecretStorage-backed token store, and the vault-artifact seed action                                 | host plugin API, `Component` | the vault      |
| `src/core/`           | The module's hexagon: the ports, the canonical DTOs, the pure `mergeField` N-way merge, every use case (`actions/`), and the neutral note arithmetic                                                                          | TypeScript                   | in-process     |
| `src/infrastructure/` | Driven adapters, one namespace per vendor — the single vault adapter and note codecs, the GitHub and Todoist mirror adapters, the registry (`SyncStateAdapter` and the baseline store), and the in-memory conformance adapter | TypeScript, GraphQL, REST v1 | external tools |

### Ports & adapters

**The core's ports (`src/core/port/`).** The core owns these; each states the
core's need, never the tool's API it wraps. An adapter implements the port from
its own module; the composition root wires it.

- **The mirror port.** **`MirrorPort`** — the external tool as one collaborator,
  implemented by `GithubMirrorAdapter` and `TodoistMirrorAdapter`. The
  required surface is the project (read/create/rename, set the archived
  state), the task (`title`, `body`, `subtasks`, `completion`, `Status`,
  `label` — one generic write entry, `applyField`, dispatches a canonical field
  to the adapter's own representation; the completion fact is separate from the
  `Status` representation; `deleteTask` removes the mirror item — the code host
  deletes the board card and the issue) and project
  origination (`resolveOrCreateProject`, which every adapter carries, so no
  declared connection is left unoriginated). The
  genuinely optional surfaces are **optional methods**: `capture?` (adopt
  remote-born tasks), `projectTime?` (the project's own clock, the archive
  fact's decisive time), `fieldTime?` (trustworthy per-field timestamps),
  `fetchComplete?` (verified-complete fetch), `materializesTodo?` (whether a
  `type:todo` becomes a standalone item — a code host does not, a task manager
  does), `taskHandlesAreUrls?` (whether a captured task's handle is a url the
  note carries or an opaque id) and `lockTask?`/`unlockTask?`
  (task locking).
  A caller checks presence
  (`adapter.lockTask !== undefined`), never a capability string or a null-gated
  port slot; an adapter without a surface simply omits the method. The project,
  task, capture, timestamp, locking and origination surfaces were separate
  facet ports; the tool is one collaborator, so it is one port.
- **The vault port.** **`VaultPort`** — the vault as one collaborator: read a
  note by path, create/write/rename/trash a note, list a folder's notes, read
  every note's own id (`readNoteIds`, across `Projecten/` and `Archief/`), and
  enumerate the project notes, subscribe to note change/delete/rename events;
  observe a task note's field as a canonical value plus its edit time (trusted
  by default), read the whole task, apply a canonical field write; read a
  project's declared connections and its task-note paths; observe and apply a
  project's archived state. Implementer:
  `VaultAdapter`. The origin, the project source and the lifecycle were separate
  facet ports served by thin wrapper adapters; the vault is
  one collaborator, so it is one port and one adapter. The port is raw vault I/O
  — the task-capture adoption orchestration (choosing the renderer, writing the
  note, recording the mirror item) lives in `CaptureTasksAction`, never in the
  adapter.
- **The supporting port.** `MirrorAdapterFactoryPort` (build a mirror adapter
  for an application + target). It is the provider table's seam, not a facet of
  a mirror adapter; the chain reaches a connection's origination surface through
  the adapter the factory builds.

**The registry port (`src/core/port/RegistryPort.ts`).** The registry is one
collaborator, so it carries one provider-neutral seam: the tracked entities and
their mirror items, the note-path↔handle and mirror-project mappings, the
per-connection identity and port state, the deleted-note tombstones, and the
side baselines. Implementer:
`SyncStateAdapter`, which also composes the handle and mirror-project
resolution. Its records `EntityRecord` (which carries the owning project's
`projectId`), `MirrorItem`, `PortState` and `TombstoneRecord` live in
`src/core/port/data/`; the baselines stay in the `coreBaselines` store.
The baseline store, mirror handle, mirror project, identity store, tracked
entity and connection state were separate facet ports served by thin wrapper
adapters; one collaborator is one port.

A component that reaches around a port is a defect.

**Why the port count is what it is.** The ports come in two families. The
_mirror port_ — `MirrorPort` — is the adapter contract: the required project and
task surfaces every adapter carries, and the genuinely optional surfaces as
optional methods a caller presence-checks. The _collaborator ports_ — the
vault's `VaultPort` and the registry's `RegistryPort` — name only the methods
the core uses. One collaborator, one port; the provider table's factories are
seams beside them.

The API tokens are not settings and not a port: they live in Obsidian's
SecretStorage behind `SecretStorageAdapter` (`src/ui/settings/`), which the
composition root reads at adapter construction and the settings tab sets and
clears. `data.json` is secret-free.

### The multi-adapter core

The `core/` block is the shape of ADR 001. It consists of the port layer, the
canonical DTOs and the pure core.

- **Canonical fields.** `canonicalField.ts` holds the six canonical fields
  (`title`, `body`, `subtasks`, `completion`, `Status`, `label`). `MirrorPort`
  carries one generic write entry, `applyField`, and the completion fact is a
  separate canonical field from the `Status` representation. `canonicalField.ts`
  also carries `MergedField` (the canonical fields plus the project-level
  `archived` fact), so the archive reconciles through the
  same `mergeField` ladder as the task fields.
- **Canonical DTOs.** `CanonicalTask`, `CanonicalProject`,
  `ConnectionDataTransferObject`,
  `CanonicalFieldWrite`, `ProjectAddressing` and `PortState` —
  one canonical shape per concept, owned by
  the core. The boundary payloads live with the ports (`core/port/data/`); a
  merge action's private working shapes stay co-located with the action. The
  merge diffs canonical fields only.
- **The merge vocabulary** lives in `domain/` beside `mergeField`: `Delta`,
  `MergeResult`, `SideObservation`, `Baseline`, `OriginObservation`. A value
  the domain reads is a domain value; the ports and the application depend
  inward on it.
- **The pure N-way merge** (`mergeField`). Sides plus exactly one origin role;
  a delta per side against its own baseline; the ladder (decisive timestamp →
  completion over a stale open → origin tie-break); delete proof (a
  verified-complete fetch plus a synced baseline); the origin's absence as a
  delete delta; the origin's edit time trusted by default. No I/O, no clocks.
- **The merge-pass driver** (`MergePassService`). The spine both merge actions
  run: scope a declared connection to its effective target and adapter, read
  every side's baseline, observe the sides, merge the one field through the pure
  ladder, fan the verdict out to the mirrors, apply it to the origin, and persist
  each advanced side's baseline. The variable half — how a side is observed, how
  the verdict reaches the mirrors, how it reaches the origin — is the plan the
  action supplies (`MergePlan`), so the field merge and the archive merge are each
  their own merge over the shared driver. It reads and writes no provider shape.
- **The provider table.** The composition root holds one plain `providers`
  table — a value mapping an application id to its mirror factory,
  project-origination surface and token setting. It derives the
  mirror-adapter factory, the registered-application set and
  the token-settings list from that table, so adding an application is one entry
  and there is no validation framework, capability vocabulary or registration
  result. The provider's name is a value in its own module and in the
  composition root only.
- **The mirror-sync action** (`MirrorSyncAction`). Given a project, it reads each
  declared connection with its slug, builds the connection's mirror adapter
  through the factory (scoped by the connection's target), resolves the entity to
  that connection's own handle through `RegistryPort`, and runs one merge pass per
  (entity, canonical value field) through the shared driver. For each field it
  collects the origin side through `VaultPort` and each mirror's observation
  against its own baseline, fans the reconciled value out through the one generic
  write entry, writes the reconciled value back to the origin (or trashes the
  note on a delete), and advances the baseline of every side written or already
  matching — a skipped write advances too; a failed write advances nothing. A
  mirror write that throws is recorded among the field outcome's `failed` sides
  and fan-out continues to the remaining mirrors, so one failing connection
  never abandons the rest. The project source enumerates note paths, so a mirror
  side is keyed `mirror:<slug>` — disjoint from the origin side's `origin` key —
  while the origin keeps the note path as its handle. A connection whose entity
  has no resolved handle is materialized: the origin task is read through
  `VaultPort.readTask` (a note without a type label is not a task and is
  skipped), a placeholder handle is recorded through `RegistryPort` before the
  item is created through `MirrorPort.createTask`, the real handle replaces the
  placeholder, and the created mirror is reconciled in the same pass. A
  placeholder left by an interrupted pass is adopted by matching the mirror's
  task title rather than re-created. A `type:todo` is materialized only where the
  mirror tracks one (`MirrorPort.materializesTodo?`): a code host creates **no
  issue** — the parent's body carries the checklist line, so the todo is
  untracked there — while a task manager creates a subtask under the parent. The
  `subtasks` field carries the parent's **identity**, not a rendering: each
  side's raw value (the origin's wikilink stem, the mirror's handle) is resolved
  through `RegistryPort` to the parent's note path, compared by identity, and
  rendered back to its own space on write — a relation that agrees by identity
  is settled. It names no provider.
- **The project lifecycle reconciliation** (`ProjectLifecycleSyncAction`). The
  project-level peer of the mirror-sync action: given a project it reads each
  connection's already-originated mirror project through `RegistryPort` — a
  connection whose remote project is absent is left unoriginated, because
  origination is the chain's single step (ORG-3) — then reads the origin's
  archived state through `VaultPort` and each mirror's through `MirrorPort`, runs
  the same merge pass over the archived fact through the shared driver, and fans
  the reconciled freeze out to the origin and every capable mirror. Any side can
  start the freeze or the unfreeze; the reconciled freeze is the pass's `frozen`
  verdict, which gates the task-field pass. A mirror project whose name drifted
  is renamed through `MirrorPort.renameProject`. The fan-out also re-drives every
  capable side whose current disagrees with the verdict whatever the merge label
  (NWM-32). Its per-side baselines live in the same `coreBaselines` store under
  the `archived` field.
- **Task locking** (`MirrorPort.lockTask?`/`unlockTask?`) and
  `ReconcileProjectTaskLocksAction`. The core's need to close a task's
  conversation while its project is frozen and reopen it on unfreeze; the code
  host implements the methods and the task manager omits them. On a lifecycle
  transition the action enumerates the project's tracked mirror items through
  `RegistryPort`, skips connections whose adapter has no `lockTask`, skips the
  tasks whose vault status is the done lane, and locks the rest — or unlocks
  every tracked task on the unfreeze.
- **The origination step** (`EnsureProjectBoardAction` +
  `MirrorPort.resolveOrCreateProject`). A project is set up by declaring its
  connections on the home note; on every pass, each declared connection
  resolves-or-creates its remote project and records its addressing. The action
  always resolves — it never trusts a recorded addressing — and the adapter
  decides: a remote project that still exists is adopted, a remote project that
  is gone is re-created. A connection's target may be empty — the remote project
  is then identified by the vault project's name (ORG-2); a non-empty target
  overrides. The plugin **never creates a code-host repository**: an empty target
  resolves an existing repo named for the vault project under the authenticated
  user, and an absent repo leaves the connection unoriginated with a logged
  error. The resolved project's own address (a code host's repository, a task
  manager's project) is recorded as the identity's `target` — the connection's
  **effective address** — and every downstream step (mirror, capture, lifecycle,
  task locking) addresses an empty-target connection by that resolved effective
  target, not the empty declared one.
  The one uniform method replaces the code-host-only setup surface, so a task
  manager originates its project the same way the code host originates its board.
  No declared connection means nothing fans out (ORG-4), and an existing remote
  project is adopted without creating anything (I14).
- **The task-capture surface** (`MirrorPort.capture` + `CaptureTasksAction`). For
  each declared connection, the core action reads the tasks the adapter's capture
  gate exposes — a code host exposes only type-labelled issues, a task manager
  exposes every task. The whole listing is scanned each pass and the adopted
  mirror items are skipped, so the pass is idempotent without a cursor; a handle
  with a tombstone is skipped too, so a deleted note's mirror is never re-adopted
  (DEL-2, I16). Each remaining task is then matched against the project's notes
  by its **normalised** title — the slug the vault derives a note's title and
  filename from (CAP-4): exactly one matching note → the task is **linked** to
  it, recording the handle on the existing note and writing no note; no match →
  the task is adopted as a new note; more than one match → nothing is written
  and the task is logged, so neither a duplicate nor a wrong link is made and the
  task is retried next pass. The adoption shape follows the adapter's
  declaration (`MirrorPort.taskHandlesAreUrls?`) — a url handle is routed
  through `CreateTaskNoteAction`, an opaque id is rendered by
  `CapturedTaskNoteMapper` and written through `VaultPort` + `RegistryPort`. A
  captured task-manager task carries a kind: an
  explicit type label is kept, and an unlabelled one takes the kind its position
  implies — a root item is a `slice`, a subtask a `task`.
- **The cutover.** `SyncProjectAction` drives the vault-maintenance steps
  (note-id migration, home-note migration, connection re-keying,
  connection origination, rename recovery, vault consistency and the deletion
  sweep) and the core actions
  directly (`ProjectLifecycleSyncAction`,
  `ReconcileProjectTaskLocksAction`, `CaptureTasksAction`, `MirrorSyncAction`),
  every step wrapped so one failure logs and skips that step. `MigrateNoteIdsAction`
  runs first: a one-shot, idempotent pass that stamps a minted id on every note
  lacking one (the home note included) at `connections.vault.id`, so a note's
  own identity always exists before any step reads it. The chain then resolves
  the home note — its `_<name>` stem, else a legacy `_home.md`/`<name>.md`, else
  the only note at the project root — reads its id from `connections`, and
  threads the work item `{ projectId, projectName }` to every step: the registry
  keys by the id and the vault resolves id → folder from the note's stored path,
  so `Projecten/` and `Archief/` are both reachable. It runs the
  lifecycle pass for the freeze verdict, the task-lock
  action on the freeze/unfreeze transition, the task capture for tracked tasks,
  and the mirror-sync pass for task-field reconciliation. The sweep proves a
  record gone by its id — a record whose note path is gone but whose id lives at
  another path is a rename, and a note whose id reappears clears its tombstone
  (DEL-1) — records a tombstone for each proven-gone note (not under
  `Archief/`), hands the delete to
  `HandleDeletedNoteAction` (a failed mirror delete is reported and retried,
  DEL-2), and prunes the tombstone and the record once every
  side has settled.
- **The project identity.** A project is a record with an id, a name and a path,
  the same kind of record a task is. The **id** is the home note's own uuid at
  `connections.vault.id`; the **name** is the folder segment it was created
  under; the **path** is where the home note currently lives, an attribute and
  not the identity. The registry keys the project by its id, and the vault
  resolves the id to the home note (and so to the folder) through `readNoteIds`.
  A folder rename therefore changes the name and the path and never the id, so
  nothing is stranded; there is no rename reconciliation to perform — the
  retired `RenameProjectAction`, the folder-drift warning and the property
  comparison are gone. The name is what origination titles the remote project
  with and what the mirror rename compares against (NWM-31); the `name:`
  frontmatter field is a title and nothing else.
- **The infrastructure adapters.** `infrastructure/` is the driven-adapter
  block: one namespace per application (`infrastructure/<vendor>/`), each
  carrying the provider's own vocabulary, its transport boundary and its opaque
  target. A real mirror adapter is a new namespace beside the existing ones,
  wired by one composition-root table entry. `infrastructure/` imports `core/`
  only, and the provider-vocabulary gate keeps each namespace the sole home for
  its provider's name.
- **The GitHub mirror adapter** (`infrastructure/github/`) implements the
  `MirrorPort` surface for the code host: title and body as the issue, Status as
  the board card's lane, completion as the issue state (kept separate from the
  lane), subtasks as the sub-issue relation, label as the issue labels, and the
  project, origination, capture, complete-fetch, per-field-timestamp and
  task-lock surfaces; `deleteTask` deletes the board card **and the issue
  itself**, so capture has nothing left to re-adopt. It reports
  `materializesTodo` false: a `type:todo` is untracked here — its parent's body
  carries the checklist line. The composition root
  registers it under the application id `github`. Its GraphQL documents
  (`githubDocuments`), wire shapes and parsers (`githubWire`) and issue-to-task
  mapper (`githubTaskMapper`) are lowercase modules beside it.
- **The Todoist mirror adapter** (`infrastructure/todoist/`) implements the
  `MirrorPort` surface for the task manager: title as the task content, body as
  the task description, Status as the project section, completion as the task's
  completed fact, subtasks as the parent relation, label as the task labels, and
  the project, origination, capture, complete-fetch and per-field-timestamp
  surfaces; it omits the locking methods. It reports `materializesTodo` true: a
  `type:todo` becomes a subtask under its parent. The composition root registers
  it under the application id `todoist`.
- **The registry adapter** (`infrastructure/registry/`) persists the core's
  memory in `data.json`: `SyncStateAdapter` (the `syncState` container and the
  `coreBaselines` store), with the pure codecs (`coreStorageRecord`,
  `syncStateSchema`, `syncStateIndex`, `loadDataSafely`) beside it.
- **The vault adapter** (`infrastructure/vault/`) implements `VaultPort`:
  `VaultAdapter`, with the pure note codecs (`connectionsOf`,
  `parseConnectionsBlock`, the task-note codec) beside
  it. It is a structural peer of the application adapters, not a capability
  adapter.
- **The conformance adapter** (`infrastructure/fake/`) is an in-memory
  `MirrorPort` test double used by the core and adapter tests. It is not wired
  into the plugin.
- **Connection validation is open.** A connection is accepted when it names a
  registered application; the composition root supplies the registered set from
  the provider table's keys, so the accepted set is not a hardcoded union. An
  application that is not registered is rejected with a collected error.

## 4. Data Stores

- **The vault** — the system of record; markdown notes, not a database.
  Project notes live under `Projecten/<name>/` (or `Archief/` when archived),
  declare their connections in a non-empty `connections` map, and take their
  name from the folder segment; every task
  note lives under `taken/`, a to-do among them carrying the `type:todo`
  label. Every note carries its own id in its `connections` map at
  `connections.vault.id` (`{ tool: vault, id: <uuid> }`); the registry keys the
  same uuid. The vault's own entry never makes a note a project — discovery
  ignores it, and a note is a project only when it carries a registered mirror
  connection (ORG-1, DISC-1, DISC-4). A `name:` frontmatter field is a title and
  carries no identity weight.
- **`data.json`** — the plugin's data file. It holds three containers:
  - **`syncState`** (schema version 4) — the per-mirror registry: `projects.<projectId>.entities`
    (uuid → note path), `projects.<projectId>.ports.<connectionSlug>.items.<handle>`
    (each mirror handle's entity id), the port bookkeeping
    (`provider`, `project`, `lastPoll`, `lanes`), per-connection identities
    (`projects.<projectId>.identities.<connectionSlug>`), and the
    per-project `fullScanPending` marker.
    The project node is keyed by the home note's own uuid, so a folder rename
    (a new name and path) never moves it and strands nothing; the archive
    baseline is keyed by the same uuid. A v3 container is migrated in place —
    the entities, ports, identities and tombstones survive, and the chain's id
    migration re-keys a name-keyed project node (and its archive baseline) to
    the home note's uuid.
    Ports are keyed by the note's connection slug, so a project can hold two
    connections of the same tool; a slug rename re-keys the port in lockstep.
    Written only through `SyncStateAdapter`, behind a serialization mutex it
    shares with the settings save.
  - **`coreBaselines`** — the core's per-entity, per-field (a canonical field or
    `archived`), per-side `Baseline` (`value`, `completed`). A sibling of
    `syncState`, so a registry write cannot clobber it.
  - The settings keys (poll interval, done option, debounce, the four artifact
    paths and the status options) live at the root beside the containers.
- **`main.js`** — the built bundle; never authored.

No other persistent store. The mirrors hold copies, never authority.

## 5. External Integrations / APIs

- **Code host** — GraphQL for the project read (issues plus board cards), issue
  creation, the board operations, locking and sub-issue relations; REST for the
  label and state updates. The core
  consumes it through `MirrorPort` (project, task, capture, and the optional
  timestamp, complete-fetch, todo-materialization, locking and origination
  methods). A fine-grained
  token, bearer.
- **Task manager** — REST v1 for projects, sections, tasks and labels. The core
  consumes it through `MirrorPort` (project, task, capture, and the optional
  timestamp, complete-fetch, todo-materialization and origination methods). An
  API token, bearer.
- **The host vault application** — the plugin API (vault read/write, events,
  `requestUrl`, settings and data). Behind `VaultPort` and the note codecs;
  only the adapter imports the host package.

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
    are the `src/` layer folders — the three core layers (`core/domain`,
    `core/application`, `core/port`), `ui`, and `infrastructure` (with the two
    provider namespaces, `infrastructure/github/` and
    `infrastructure/todoist/`, as their own elements) — plus the src root (the
    composition root); inside the hexagon `core/domain` imports nothing,
    `core/application` may import the domain and the ports, and `core/port`
    may reference the domain only (its payloads live with the port);
    `infrastructure/` may import the core only; the provider namespaces never
    import each other; `ui/` reaches the core through the ports and
    infrastructure only for the storage key it shares with the registry
    adapter; the composition root wires everything. An unlisted import edge
    fails the lint, so the hexagon stays neutral and a domain or port file that
    imports outward cannot land. The seam is bite-tested
    (`tests/scripts/boundary-isolation.test.ts`): a domain→application, a
    domain→port and a port→application import each exit non-zero while
    application→domain exits zero.
  - **`boundaries/no-unknown-files`** and **`no-unknown-dependencies`** —
    every source file must belong to an element and every local import must
    resolve to one, so a new top-level module (including `core/` and
    `infrastructure/`) cannot slip in unclassified.
  - **`pnpm run lint:boundaries`** (`scripts/lint-boundaries.mjs`) — the
    provider-vocabulary gate. A provider name may appear only in the provider's
    own module (`infrastructure/<vendor>/`) and the composition root
    (`main.ts`); a capitalized provider name anywhere else fails. Inside the
    neutral architecture (`core/`, `infrastructure/`) the check is
    case-insensitive, so any provider name in the core fails. The gate is
    bite-tested (`tests/scripts/lint-boundaries.test.ts`): a deliberate core
    violation exits non-zero while the legitimate provider path exits zero, so a
    green gate on an empty tree cannot pass unnoticed.
  - **`pnpm run lint:naming`** (`scripts/lint-naming.mjs`) — the role-folder ↔
    suffix gate: a class in a role folder carries that folder's suffix
    (`core/port/` → `*Port`, `core/domain/errors/` → `*Error`,
    `core/application/actions/` → `*Action`). Bite-tested
    (`tests/scripts/lint-naming.test.ts`): a mis-suffixed file exits non-zero.
  - **`pnpm run typecheck`** — strict tsc; a class of runtime bugs becomes a
    compile error.
  - **`pnpm test`** — behavioral tests per module, including the mirror-sync
    action's integration tests.

## 9. Future Considerations / Roadmap

**Deliberate non-goals:**

- **No second provider wired.** The ports are provider-neutral, so a second
  code host or task manager is a matter of implementing the ports — but only
  GitHub and Todoist are wired today. The ports keep that door open; they do not
  justify a speculative adapter.
- **No conflict UI.** A multi-sided field conflict is resolved by rule, not by a
  person. The decision ladder's decisive-timestamp, completion-over-open and
  origin-authority rungs always produce a verdict, so no field is ever left for
  a human to arbitrate. A conflict dialog was excluded on purpose.
- **No server or database.** The registry is the plugin's own `data.json`; the
  vault is the system of record. There is no backend.
- **No permanent deletion.** A deleted note is a tracked change: its absence is
  recorded as a tombstone, the delete fans out to every mirror (the code host's
  card and issue are deleted outright), and the tombstone and registry record are
  pruned once every side has settled. The vault note itself is trashed, never
  destroyed.

**Known debt / open items:** A project is keyed by the home note's own uuid
(S31); its name is the folder segment, and a folder rename changes the name and
the path and never the id, so nothing is re-keyed and nothing is stranded. The
project-level delete is still deferred (`DEL-3`): projects are never
captured, so nothing resurrects — a gone folder leaves the remote project in
place, and the positive "gone, not renamed" verdict is decided separately. The
vault-maintenance shell has been
retired — the chain drives its steps directly (ADR 003).

The multi-adapter core (`core/` + `infrastructure/`) is wired end to end: the
GitHub and Todoist mirror adapters implement `MirrorPort`, the vault
origin adapters complete the origin round-trip, the mirror-sync action and the
core baseline store reconcile a whole project and persist its baselines, the
lifecycle pass reconciles the archived fact, a declared connection
resolves-or-creates its remote project, capture adopts remote-born tasks, and the
task-lock action handles a
frozen project. The runtime cutover is unconditional: the
chain builds the origin and the per-connection mirror adapters from the
project's connections and the stored secrets and drives the core actions
every pass.

## 10. Project Identification

Project Name: obsidian-project-management

Repository URL: https://github.com/99linesofcode/obsidian-project-management

Primary Contact/Team: Jordy Schreuders (99linesofcode)

Date of Last Update: 2026-10-13

## 11. Glossary / Acronyms

- **Vault** — the markdown note store the plugin runs inside; the origin of
  truth.
- **Mirror** — a copy of the vault's content on a remote (the code host or the
  task manager). A mirror is never authoritative.
- **Hub / entity** — one vault-owned thing (a task or to-do note) carrying a
  uuid; mirrors are its leaves.
- **Port** — a provider-neutral interface the core owns, stating the core's
  need; an adapter implements it.
- **Optional surface** — a surface not every adapter carries; it is an optional
  method on `MirrorPort`, absent from an adapter that lacks it, so a caller
  checks presence rather than gating on a declared capability.
- **Canonical field** — one of the six neutral field names (`title`, `body`,
  `subtasks`, `completion`, `Status`, `label`) the merge operates on.
- **Baseline** — the last-synced snapshot of a side; the third input to a
  side's delta. The core stores one per entity, field and side under
  `coreBaselines`.
- **Delta** — one side's change against its own baseline: a value, or a delete
  proven by a verified-complete fetch.
- **Tombstone** — a registry record of a deleted note (entity id, note path,
  delete time and an optional mirror handle). It stops capture re-adopting the
  handle and is pruned with the entity once every side has settled.
- **Decision ladder** — the ordered rules `mergeField` applies to a
  multi-sided conflict: decisive timestamp, then completion over a stale open,
  then origin authority.
- **Origin** — the vault side, distinguished by role: it supplies the tie-break,
  its edit time is trusted by default, and its absence is a delete.
- **Lane** — a board column / task-manager section.
- **Outward materialization** — creating a mirror for a vault-born task,
  placeholder-first: the mirror-sync action records a placeholder handle before
  it creates the missing item through the adapter, stamps the real handle over
  the placeholder, and reconciles it in the same pass; an interrupted pass
  adopts the created item instead of duplicating it. A `type:todo` is the
  exception: it materializes only where the mirror tracks one, so a code host
  creates no issue while a task manager creates a subtask.
- **Parent identity** — the canonical value of the `subtasks` field: the
  parent's note path, not a rendering. The origin renders it as a wikilink stem
  and the mirror as a handle; each side's raw value resolves through the
  registry to the identity, so a relation the two sides name alike settles.
- **Origination** — resolving-or-creating the remote project a declared
  connection names. A connection declares a tool and a target; an empty target
  means the remote project is identified by the vault project's name, a
  non-empty target overrides. The one uniform method,
  `MirrorPort.resolveOrCreateProject`, serves the code host's board and the task
  manager's project alike; no declared connection means nothing fans out.
- **Capture** — adopting remote-born **tasks** into the vault. It enumerates the
  remote's tracked tasks and handles each the vault does not already hold by its
  mirror handle, so the first run adopts the back-catalogue and a second pass is
  idempotent. A task whose **normalised** title (the slug the vault derives a
  note's title and filename from) matches exactly one existing note is **linked**
  to that note — its handle recorded, no note written; no match adopts a new
  note; more than one match writes nothing and is logged, retried next pass. A
  project is never captured — it is declared (origination). A captured
  task-manager task carries a kind — an explicit type label kept, else `slice`
  for a root item and `task` for a subtask.
- **Project identity** — the record that makes a project a project: an id (the
  home note's own uuid at `connections.vault.id`), a name (the folder segment it
  was created under) and a path (where the home note lives). The home note is
  the project-root note whose stem is `_<name>`, else a legacy `_home.md` or
  `<name>.md`, else the only note at the project root. The registry keys
  the project by its id; the vault resolves id → folder from the note's stored
  path. A folder rename changes the name and the path and never the id, so no
  reconciliation is needed.

## 12. Conventions & Boundaries

The house standards this repository adheres to — stated here in full.
Enforced by `eslint-plugin-boundaries` (elements = the layer folders) and the
`lint:boundaries` vocabulary grep:

- **Folder structure**: module-first (ADR 004), lowercase; the repo is the
  module, its interior is `ui/` (driving), `core/` (hexagon) and
  `infrastructure/` (driven); a single-context module keeps `application/`,
  `domain/` and `port/` at `core`'s root, with no component wrapper. The
  folder locates the role; a consumer folder (`create-task-note/`) holds an
  action's exclusive collaborators.
- **File naming**: PascalCase classes with role suffixes (`*Action`,
  `*Adapter`, `*Port`, `*Mapper`, `*Parser`, `*DataTransferObject`);
  camelCase pure modules grouped by subject (`note.ts`, `paths.ts`,
  `affiliation.ts`), not one file per helper.
  Tests mirror the tree: `tests/<module>/…`.
- **Entry point**: `src/main.ts` — above the layers, never inside one; the
  composition root.
- **Dependency matrix**: `core/domain` imports nothing outward; `core/port`
  imports the domain only; `core/application` imports the domain and the ports;
  `infrastructure/` imports
  `core/` only; provider namespaces never import each other; `ui/` reaches the
  core through the ports and infrastructure only for the storage key it shares
  with the registry adapter; the composition root wires everything; no circular
  module dependencies.
- **Provider neutrality**: a provider name appears only in the provider's own
  module (`infrastructure/<vendor>/`) and the composition root; cross-cutting
  vocabulary is neutral (a provider name is a
  value argument, never a namespace key). The neutral architecture (`core/`,
  `infrastructure/`) is checked case-insensitively, so any provider name in the
  core fails.
- **Class vs function**: a class carries injected collaborators or behaviour —
  actions, adapters, a value object that enforces an invariant; a DTO is a
  `readonly` field holder, not a behaviour object; a pure
  codec (a mapper or parser of the same note text) is a function or a plain
  namespace object, never a stateful service. Pure transforms are grouped by
  subject into a lowercase module (`note.ts`, `paths.ts`, `affiliation.ts`,
  `checklist.ts`) — a value object where the behaviour belongs to a concept and
  enforces an invariant, a plain module where the transforms own nothing — not
  one file per helper; an interface consumed elsewhere gets its own file.
- **Canonical DTOs**: one canonical shape per domain concept, owned by the
  core; diff/merge logic operates on canonical fields only. A DTO mimicking a
  provider's structure is a provider shape, whatever its file name.
- **The vault wins**: a field changed on both sides resolves by origin
  authority; only a remote field time that provably postdates every local edit
  overrides it.
- **Base advances only after durable writes**: a side's baseline is stored after
  its write lands; a failed write advances nothing.
- **Documentation surfaces**: WHY comments at the change site; the developer
  manual (`docs/developer-manual.md`) updated when a flow changes.
