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
│   │   ├── application/ # use cases (actions/), DTOs (data/), the reconciler
│   │   │                # interfaces (services/)
│   │   ├── domain/      # the neutral note arithmetic and the domain error
│   │   │                # (errors/)
│   │   └── port/        # the capability and collaborator ports
│   ├── infrastructure/  # driven adapters, one namespace per vendor:
│   │                    # vault/ (origin, project source, lifecycle, capture,
│   │                    # note codecs), github/ (mirror adapter + descriptor +
│   │                    # transport), todoist/ (mirror adapter + descriptor +
│   │                    # transport), registry/ (the data.json-backed registry),
│   │                    # fake/ (in-memory conformance adapter)
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
Pure calculations live in one-function files (`mergeField`, `mirrorSideKey`,
`originSideObservation`). Delivery mechanics — the scheduler, the queue,
timers — belong to `ui/` and make no business decisions. Persistence is owned
by the registry adapter; nothing else touches `data.json`.

**The core.** `core/` is the module's hexagon. `application/` holds the use
cases (`actions/`), the canonical DTOs (`data/`) and the reconciler interfaces
(`services/`); `domain/` holds the neutral note arithmetic and the domain
error (`errors/`); `port/` holds the capability and collaborator ports. It
names no provider. `infrastructure/` holds the driven adapters that implement
those ports, one namespace per vendor. The composition root wires them. The
old provider halves, the pairwise verdict and the legacy writers are deleted;
the chain drives the vault-maintenance steps (board-ensure, rename recovery,
vault consistency, deletion sweep) directly, documented in the developer
manual.

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
mirror's last-synced baseline (the registry's per-mirror base and the core's
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

## 3. Core Components

| Component             | Responsibility                                                                                                                                                                                                                                                                                            | Technology                   | Target         |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------- | -------------- |
| `src/main.ts`         | The composition root: plugin lifecycle, settings load, wiring, startup discovery and the project-capture pre-tick                                                                                                                                                                                         | host plugin API              | the vault      |
| `src/ui/`             | Driving side: `SyncScheduler` (delivery mechanics), `SyncQueue` (one serialized chain), the settings tab and schema, the SecretStorage-backed token store, and the vault-artifact seed action                                                                                                             | host plugin API, `Component` | the vault      |
| `src/core/`           | The module's hexagon: the capability vocabulary and ports, the canonical DTOs, the pure `mergeField` N-way merge, the adapter descriptor/registrar, every use case (`actions/`), the pass assemblers, the reconciler interfaces, and the neutral note arithmetic                                          | TypeScript                   | in-process     |
| `src/infrastructure/` | Driven adapters, one namespace per vendor — the vault origin/project-source/lifecycle/capture adapters and note codecs, the GitHub and Todoist mirror adapters, the registry (the pass seams' implementation plus the core baselines/handles/project/cursor/watch), and the in-memory conformance adapter | TypeScript, GraphQL, REST v1 | external tools |

### Ports & adapters

**The core's ports (`src/core/port/`).** The core owns these; each states the
core's need, never the tool's API it wraps. An adapter registers from its own
module and exposes only the ports its descriptor declares.

- **Capability ports.**
  - **`ProjectPort`** (`project`, `lifecycle`) — read/create/rename a mirror
    project, set and read its archived state.
  - **`TaskSurfacePort`** (`title`, `body`, `subtasks`,
    `completion`, `Status`, `label`) — list/read/create a task and one generic
    write entry, `applyField`, that dispatches a canonical field to the
    adapter's own representation; the completion fact is separate from the
    `Status` representation. `deleteTask` removes the mirror item.
  - **Optional ports** — `CapturePort` (`capture`), `ProjectCapturePort`
    (`capture`), `CompleteFetchPort` (`complete-fetch`), `TimestampedPort`
    (`trustworthy per-field timestamps`), `TaskLockPort` (`task-locking`),
    `ProjectActivityPort` (`project-activity`). The two capture ports share the
    one `capture` capability; a provider that could adopt application-born
    projects but not tracked tasks would need the capability split, which no
    adapter does yet.
- **The origin ports.** **`OriginPort`** — observe a task note's field as a
  canonical value plus its edit time (trusted by default), read the whole task,
  apply a canonical field write, trash the note (never a permanent delete).
  **`ProjectLifecycleOriginPort`** — observe a project's archived state and
  apply it. The origin is a role, not an application: it gets no descriptor.
- **The setup port.** **`ProjectSetupPort`** — discover a target's projects,
  resolve project addressing, create or adopt a project with the core's Status
  vocabulary, and list viewer projects. The code-host adapter implements it;
  discovery, attach and board-ensure depend on it.
- **The supporting ports.** `ProjectSourcePort` (a project's declared
  connections and its task-note paths), `BaselineStorePort` (one side's
  baseline for an entity + field), `MirrorHandlePort` (resolve/record/enumerate
  a connection's handle for a note), `MirrorProjectPort` (resolve/record a
  connection's mirror-project handle), `MirrorAdapterFactoryPort` (build a
  mirror adapter for an application + target; expose the capture sources),
  `ProjectCaptureCursorPort` (the per-surface creation watermark),
  `ProjectCaptureVaultPort` and `TaskCaptureVaultPort` (the vault sinks), and
  `ProjectWatchPort` (the reactivation watch).

**The pass's seams (`src/core/port/`).** The chain and the driving
side reach the vault and the registry through seven narrow, provider-neutral
seams, each naming only the methods its call sites use:

- **Note I/O.** `NoteReaderPort` (read a note by path), `NoteWriterPort`
  (create, write, rename and trash a note), `NoteEnumeratorPort` (list the notes
  under a folder; enumerate the project notes) and `VaultEventPort` (subscribe
  to note change/delete/rename events). Implementer: `VaultAdapter`.
- **Registry.** `IdentityStorePort` (a connection's board identity),
  `TrackedEntityPort` (the tracked entities and their mirror items) and
  `ConnectionStatePort` (a project's per-connection port state and its
  re-keying). Implementer: `SyncStateAdapter`. Its records `EntityRecord`,
  `MirrorItem` and `PortState` live in `src/core/application/data/`.

The seven seams are the whole vault and registry contract. The former
monolithic `VaultPort` and `SyncStatePort` are gone, so every consumer — the
chain, the core's `CreateTaskNoteAction` and the driven adapters alike —
depends on the narrow seams above.

A component that reaches around a port is a defect.

**Why the port count is what it is.** The ports come in two families. The
_capability ports_ — `ProjectPort`, `TaskSurfacePort` and the optional
capabilities — are the adapter contract: an adapter declares the capabilities
it has, and an undeclared one has no interface to call (ADR 001's ≤5 grouped
surfaces). The _collaborator ports_ — the vault's note seams, the registry's
identity / tracked-entity / connection-state seams, the capture sinks and the
core-registry stores — are deliberately narrow: each names only the methods its
call sites use, so a consumer that only reads notes depends on a read-only
interface. Collapsing a collaborator port into one wide interface trades that
interface segregation for a smaller file count, and the cost is real: a
read-only test double would have to implement the whole surface. The seams
therefore stay narrow by design; the count is a consequence of the split, not
redundancy.

The API tokens are not settings and not a port: they live in Obsidian's
SecretStorage behind `SecretStorageAdapter` (`src/ui/settings/`), which the
composition root reads at adapter construction and the settings tab sets and
clears. `data.json` is secret-free.

### The multi-adapter core

The `core/` block is the shape of ADR 001. It consists of the port layer, the
canonical DTOs and the pure core.

- **Capability vocabulary.** `Capabilities.ts` holds the thirteen capability
  names; `canonicalField.ts` holds the six canonical fields. `TaskSurfacePort`
  carries one generic write entry, `applyField`, and the completion fact is a
  separate canonical field from the `Status` representation.
- **Canonical DTOs.** `CanonicalTask`, `CanonicalProject`, `Baseline`,
  `SideObservation`, `OriginObservation`, `Delta`, `MergeResult`, `MirrorSide`,
  `MirrorSyncPass`, `PassRecord`, `ProjectLifecyclePass`,
  `ProjectLifecycleRecord`, `DeclaredConnection`, `ConnectionEnvelope`,
  `CanonicalFieldWrite`, `CapturedProject`, `AdoptedProject`, `ProjectSummary`,
  `ProjectCandidate`, `ProjectDiscovery`, `ProjectAddressing`, `ProjectState`
  and `ProjectActivityObservation` — one canonical shape per concept, owned by
  the core. The merge diffs canonical fields only.
- **The pure N-way merge** (`mergeField`). Sides plus exactly one origin role;
  a delta per side against its own baseline; the ladder (decisive timestamp →
  completion over a stale open → origin tie-break); delete proof (a
  verified-complete fetch plus a synced baseline); the origin's absence as a
  delete delta; the origin's edit time trusted by default. No I/O, no clocks.
- **The descriptor and registrar.** Each adapter exports a typed
  `AdapterDescriptor` (application id, capabilities, per-field
  representations, secret keys, settings rows). The composition root assembles
  a plain list of `AdapterRegistration`s and passes it to the pure
  `registerAdapters`, which validates (known capabilities, all required fields,
  the required capability floor (`REQUIRED_CAPABILITIES`), a unique lowercase
  application id, known
  settings-row kinds) and returns the accepted adapters as a `RegistrationResult`
  of `RegisteredAdapter`s, each exposing only the ports its descriptor declares.
  The composition root holds one `providers` table — one entry per application
  (descriptor, mirror factory, capture source, optional setup port) — and
  derives the descriptor list, the setup factory and the mirror-adapter factory
  from it, so adding an application is one entry.
- **The generic mirror-sync action** (`MirrorSyncAction`). It names no provider:
  it collects each capable mirror's observation against its own baseline, calls
  the single `mergeField`, and fans the reconciled value out through the one
  generic write entry. It also writes the reconciled value back to the origin
  (or trashes the note on a delete), and advances the baseline of every side
  written or already matching — a skipped write advances too; a failed write
  advances nothing. A mirror write that throws is recorded on the pass record's
  failed sides and fan-out continues to the remaining mirrors, so one failing
  connection never abandons the rest.
- **The pass assembler** (`AssembleProjectPassAction`). Given a project, it
  reads each declared connection with its slug, builds the connection's mirror
  adapter through the factory (scoped by the connection's target), resolves the
  entity to that connection's own handle through the mirror-handle port,
  assembles the origin side through `OriginPort` and each mirror's baseline
  through the baseline store, and runs `MirrorSyncAction` once per (entity,
  canonical value field) against a per-connection `MirrorSide`. The project
  source enumerates note paths, so a mirror side is keyed `mirror:<slug>` —
  disjoint from the origin side's `origin` key — while the origin keeps the note
  path as its handle. A connection whose entity has no resolved handle is
  materialized: the origin task is read through `OriginPort.readTask` (a note
  without a `type` is not a task and is skipped), a placeholder handle is
  recorded through the mirror-handle port before the item is created through
  `TaskSurfacePort.createTask`, the real handle replaces the placeholder, and
  the created mirror is reconciled in the same pass. A placeholder left by an
  interrupted pass is adopted by matching the mirror's task title rather than
  re-created.
- **The project lifecycle reconciliation** (`ProjectLifecycleSyncAction` +
  `AssembleProjectLifecyclePassAction`). The project-level peer of the
  mirror-sync action: it resolves each connection's mirror project through
  `MirrorProjectPort`, onboarding a missing one via `ProjectPort.createProject`,
  then reads the origin's archived state through `ProjectLifecycleOriginPort`
  and each mirror's through `ProjectPort`, runs the same pure `mergeField`
  ladder over the archived fact, and fans the reconciled freeze out to the
  origin and every capable mirror. Any side can start the freeze or the
  unfreeze; the reconciled freeze is the pass's `frozen` verdict, which gates
  the task-field pass. A mirror project whose name drifted is renamed through
  `ProjectPort.renameProject`. Its per-side baselines live in the same
  `coreBaselines` store under the `lifecycle` field.
- **The task-lock port** (`TaskLockPort`) and `ReconcileProjectTaskLocksAction`.
  The core's need to close a task's conversation while its project is frozen
  and reopen it on unfreeze; the code host declares `task-locking` and the task
  manager does not. On a lifecycle transition the action enumerates the
  project's tracked mirror items through the mirror-handle port, skips the
  tasks whose vault status is the done lane, and locks the rest — or unlocks
  every tracked task on the unfreeze.
- **The project-activity port** (`ProjectActivityPort`) and
  `ReactivateFrozenProjectAction`. The core's need to notice that new work
  appeared on a frozen project's mirror; the code host declares
  `project-activity`. The action runs before the lifecycle pass: when the origin
  was already frozen and the mirror's newest item provably postdates the stored
  watch cursor, it unfreezes the origin, so the lifecycle pass fans the unfreeze
  out to every mirror. The first watch adopts the newest item as the cursor.
- **The project-capture surface** (`ProjectCapturePort` +
  `CaptureProjectsAction`). A capture-capable adapter enumerates the
  application-born projects it can see, each carrying its name, its candidate
  connection targets and its creation clock. The core action reads each source's
  projects in creation order, adopts every project after that source's stored
  cursor that the vault does not already declare — writing the home note with
  its connection envelope through `VaultProjectCaptureAdapter` — and advances
  the cursor only over the projects it handled. A first sight adopts the newest
  clock and captures nothing; a project that links zero or several targets stops
  the watermark with a collected error.
- **The task-capture surface** (`CapturePort` + `CaptureTasksAction`). For each
  declared connection whose adapter declares `capture`, the core action reads
  the tracked tasks the adapter can see (those carrying a `type:` label) and
  adopts every task the vault does not already hold as a task note. The whole
  listing is scanned each pass and the adopted mirror items are skipped, so the
  pass is idempotent without a cursor. The vault sink routes by the connection's
  application — a code-host issue through `CreateTaskNoteAction`, a
  task-manager task through `CapturedTaskNoteMapper`.
- **The cutover.** `SyncProjectAction` drives the vault-maintenance steps
  (home-note migration, connection re-keying, board-ensure, rename recovery,
  vault consistency and the deletion sweep) and the `CoreReconcilers` bundle
  (the five reconcilers — `TaskFieldReconciler`, `TaskCaptureReconciler`,
  `ProjectLifecycleReconciler`, `ProjectTaskLocksReconciler`,
  `ProjectReactivationReconciler`) directly, every step wrapped so one failure
  logs and skips that step. It runs the reactivation action before the assembled
  lifecycle pass (unfreezing the origin when newer mirror work appears), the
  assembled lifecycle pass for the freeze verdict, the task-lock action on the
  freeze/unfreeze transition, the assembled task capture for tracked tasks, and
  the assembled pass for task-field reconciliation. The sweep enumerates the
  project's code-host connections directly, and the capture pre-tick runs the
  assembled core capture.
- **The infrastructure adapters.** `infrastructure/` is the driven-adapter
  block: one namespace per application (`infrastructure/<vendor>/`), each
  carrying the provider's own vocabulary, its transport boundary, its opaque
  target and its descriptor. The conformance adapter is the reference
  implementation; a real mirror adapter is a new namespace beside it, with no
  domain edit. `infrastructure/` imports `core/` only, and the provider-vocabulary
  gate keeps each namespace the sole home for its provider's name.
- **The GitHub mirror adapter** (`infrastructure/github/`) implements the
  capability ports for the code host: title and body as the issue, Status as the
  board card's lane, completion as the issue state (kept separate from the
  lane), subtasks as the sub-issue relation, label as the issue labels, and the
  project, setup, capture, complete-fetch, per-field-timestamp, task-lock and
  activity surfaces. Its descriptor registers under the application id
  `github`.
- **The Todoist mirror adapter** (`infrastructure/todoist/`) implements the
  capability ports for the task manager: title as the task content, body as the
  task description, Status as the project section, completion as the task's
  completed fact, subtasks as the parent relation, label as the task labels, and
  the project, capture, complete-fetch and per-field-timestamp surfaces. Its
  descriptor registers under the application id `todoist`.
- **The registry adapters** (`infrastructure/registry/`) persist the core's
  memory in `data.json` beside the registry's: `CoreBaselineStoreAdapter`
  (`coreBaselines`), `CoreProjectWatchAdapter` (`coreWatches`),
  `RegistryMirrorHandleAdapter`, `RegistryMirrorProjectAdapter` and
  `RegistryProjectCursorAdapter`.
- **The vault adapters** (`infrastructure/vault/`) implement the origin and
  capture ports: `VaultOriginAdapter`, `VaultProjectLifecycleAdapter`,
  `VaultProjectSourceAdapter`, `VaultProjectCaptureAdapter` and
  `VaultTaskCaptureAdapter`. They are structural peers of the application
  adapters, not capability adapters.
- **The conformance adapter** (`infrastructure/fake/`) is an in-memory adapter
  registered at the composition root. It is inert unless a project names its
  application id, so the plugin behaves exactly as before.
- **Connection validation is open.** A connection is accepted when it names a
  registered application; the composition root supplies the registered set from
  the adapters it registers, so the accepted set is not a hardcoded union. An
  application that is not registered is rejected with a collected error.

## 4. Data Stores

- **The vault** — the system of record; markdown notes, not a database.
  Project notes live under `Projecten/<name>/` (or `Archief/` when archived)
  and declare their connections in a non-empty `connections` map; task
  notes under `taken/`; to-do notes under `todos/`. Identity is a
  vault-owned uuid held in the registry — filenames and frontmatter carry no
  machine id.
- **`data.json`** — the plugin's data file. It holds three containers:
  - **`syncState`** (schema version 3) — the per-mirror registry: `projects.<name>.entities`
    (uuid → note path), `projects.<name>.ports.<connectionSlug>.items.<handle>`
    (each mirror's last-synced base, a `TaskData`), the port bookkeeping
    (`provider`, `project`, `lastPoll`, `lanes`), per-connection identities
    (`projects.<name>.identities.<connectionSlug>`), watch state, the
    per-project `fullScanPending` marker, and the per-surface `projectCursors`.
    Ports are keyed by the note's connection slug, so a project can hold two
    connections of the same tool; a slug rename re-keys the port in lockstep.
    Written only through `SyncStateAdapter`, behind a serialization mutex it
    shares with the settings save.
  - **`coreBaselines`** — the core's per-entity, per-field (a canonical field or
    `lifecycle`), per-side `Baseline` (`value`, `completed`). A sibling of
    `syncState`, so a registry write cannot clobber it.
  - **`coreWatches`** — the core's per-project, per-connection reactivation
    watch (`etag`, `cursor`). A sibling of `syncState`.
  - The settings keys (poll interval, done option, debounce, paths, status
    options, type labels) live at the root beside the containers.
- **`main.js`** — the built bundle; never authored.

No other persistent store. The mirrors hold copies, never authority.

## 5. External Integrations / APIs

- **Code host** — GraphQL for the project read (issues plus board cards), issue
  creation, the board operations, locking and sub-issue relations; REST for the
  conditional watch read (ETag / 304) and the label and state updates. The core
  consumes it through the capability ports (`ProjectPort`, `TaskSurfacePort`,
  `CapturePort`, `ProjectCapturePort`, `CompleteFetchPort`, `TimestampedPort`,
  `TaskLockPort`, `ProjectActivityPort`) and `ProjectSetupPort`. A fine-grained
  token, bearer.
- **Task manager** — REST v1 for projects, sections, tasks and labels. The core
  consumes it through the capability ports (`ProjectPort`, `TaskSurfacePort`,
  `CapturePort`, `ProjectCapturePort`, `CompleteFetchPort`, `TimestampedPort`).
  An API token, bearer.
- **The host vault application** — the plugin API (vault read/write, events,
  `requestUrl`, settings and data). Behind the pass's narrow note seams
  (`NoteReaderPort`, `NoteWriterPort`, `NoteEnumeratorPort`, `VaultEventPort`)
  and the origin adapters; only the adapters import the host package.

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
    are the `src/` layer folders — `core`, `ui`, and `infrastructure` (with
    the two provider namespaces, `infrastructure/github/` and
    `infrastructure/todoist/`, as their own elements) — plus the src root (the
    composition root); `core/` is the hexagon and imports no module;
    `infrastructure/` may import `core/` only; the provider namespaces never
    import each other; `ui/` reaches the core through the ports and
    infrastructure only for the storage key it shares with the registry
    adapter; the composition root wires everything. An unlisted import edge
    fails the lint, so the dependency graph stays acyclic and the hexagon
    stays neutral.
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
  - **`pnpm test`** — behavioral tests per module, including the core pass
    assembler's integration tests.

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
- **No permanent deletion.** A deleted note's echoes are removed from the
  mirrors, but the vault note itself is trashed, never destroyed.

**Known debt / open items:** None blocking. The vault-maintenance shell has been
retired — the chain drives its steps directly (ADR 003). The developer manual
records the remaining code-vs-brief discrepancy (the scheduler's injected
pre-tick capture).

The multi-adapter core (`core/` + `infrastructure/`) is wired end to end: the
GitHub and Todoist mirror adapters implement the capability ports, the vault
origin adapters complete the origin round-trip, the pass assembler and the core
baseline store assemble a whole project pass and persist its baselines, the
lifecycle pass reconciles the archived fact, the capture surfaces adopt
remote-born projects and tracked tasks, and the task-lock and reactivation
reconcilers handle a frozen project. The runtime cutover is unconditional: the
chain builds the origin and the per-connection mirror adapters from the
project's connections and the stored secrets and drives the core reconcilers
every pass.

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
- **Capability** — a named surface an adapter declares in its descriptor. Eight
  are required of every adapter; the rest are optional, and an undeclared
  optional port is absent, so a capability the adapter lacks has no interface to
  call.
- **Canonical field** — one of the six neutral field names (`title`, `body`,
  `subtasks`, `completion`, `Status`, `label`) the merge operates on.
- **Baseline** — the last-synced snapshot of a side, stored in the registry;
  the third input to a side's delta. The registry stores one per mirror base; the
  core stores one per entity, field and side under `coreBaselines`.
- **Delta** — one side's change against its own baseline: a value, or a delete
  proven by a verified-complete fetch.
- **Decision ladder** — the ordered rules `mergeField` applies to a
  multi-sided conflict: decisive timestamp, then completion over a stale open,
  then origin authority.
- **Origin** — the vault side, distinguished by role: it supplies the tie-break,
  its edit time is trusted by default, and its absence is a delete. It gets no
  descriptor.
- **Lane** — a board column / task-manager section.
- **Outward materialization** — creating a mirror for a vault-born task,
  placeholder-first: the pass assembler records a placeholder handle before it
  creates the missing item through the adapter, stamps the real handle over the
  placeholder, and reconciles it in the same pass; an interrupted pass adopts
  the created item instead of duplicating it.
- **Capture** — adopting a remote-born project or tracked task into the vault. A
  project capture is guarded by a per-surface creation watermark; a task capture
  scans the whole application listing for the tracked tasks (those carrying a
  type label) and skips the mirror items already stamped, so it needs no cursor.
- **Reconciler** — the `src/core/` interface through which `SyncProjectAction`
  drives one assembled core action (task fields, lifecycle, task locks,
  reactivation, capture).

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
  camelCase pure functions, one per file (`mergeField.ts`, `mirrorSideKey.ts`).
  Tests mirror the tree: `tests/<module>/…`.
- **Entry point**: `src/main.ts` — above the layers, never inside one; the
  composition root.
- **Dependency matrix**: `core/` imports no module; `infrastructure/` imports
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
  actions, adapters, the `DataTransferObject` base that serializes a DTO for
  hashing; a DTO is a `readonly` field holder, not a behaviour object; a pure
  codec (a mapper or parser of the same note text) is a function or a plain
  namespace object, never a stateful service. Everything pure is a lowercase
  single-function file (`mergeField.ts`, `slugify.ts`, `checklist.ts`), one
  concern per file; an interface consumed elsewhere gets its own file.
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
