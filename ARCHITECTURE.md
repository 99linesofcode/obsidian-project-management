# ARCHITECTURE.md

The architecture document for this repository, following the
[architecture.md](https://architecture.md) schema — built so an agent (or a
new colleague) can comprehend the codebase from this file alone, and so the
architectural principles in the `software-architecture` and
`software-development` skills are visible in how this repo actually works.
The Node/TypeScript conventions from
[node-skeleton](https://github.com/99linesofcode/node-skeleton) are baked in
(ARCHITECTURE.md there is the canonical statement). Fill every section;
update it in the same change that alters the architecture it describes.

The behavioral contract is
`planning/opm-identity-model/scenarios.md` (capabilities DISC…PRB); the
narrative walk-through of every flow is `docs/developer-manual.md`. This file
is the map; those two are the territory.

## 1. Project Structure

Module-first, lowercase — the top level screams the domain. The architecture
axis is carried by file-name role suffixes (`Action`, `Adapter`, `Port`,
`Mapper`), not layer folders. The composition root is `src/main.ts`, at the
src root, above the modules. Tests mirror the tree; the developer manual
lives in `docs/`.

```
obsidian-project-management/
├── src/
│   ├── app/          # driving side: composition root (main.ts), scheduler,
│   │                 #   queue, commands, modals, settings, setting tab
│   ├── sync/         # the per-project chain and the provider-neutral halves
│   ├── github/       # the code-host mirror: adapter, half, writer, mapper
│   ├── todoist/      # the task-manager mirror: adapter, half, writers,
│   │                 #   absorbers, mappers
│   ├── vault/        # the Obsidian vault adapter and note parsers/mappers
│   ├── registry/     # the SyncStatePort adapter: schema, migrations, loader
│   ├── projects/     # project lifecycle: discovery, attach, board, archive,
│   │                 #   remote-project capture
│   ├── tasks/        # task-note actions: create, write, promote, cascade
│   ├── todos/        # to-do notes: checklist sync and status mirroring
│   ├── shared/       # the kernel: ports, canonical DTOs, pure helpers
│   └── main.ts       # the composition root — wires every provider
├── tests/            # mirrors src/, plus helpers/ (fakes, conformance)
├── docs/             # developer manual — every flow as a sequence diagram
├── scripts/          # esbuild bundle, eslint TS resolver, live probes
├── eslint.config.js  # boundary enforcement (eslint-plugin-boundaries)
└── manifest.json     # Obsidian plugin manifest
```

**Where the logic lives.** Actions carry every use case: a class with an
`execute`, one meaningful thing, composed of smaller actions. Pure
calculations sit beside the actions as one-function files (`toDiffView.ts`,
`freePath.ts`, `stateFromStatus.ts`) — no DI, no I/O. Domain services that
span entities but own none (`VerdictResolver`, `Reconciliation`) are pure
classes in `shared/`. Delivery mechanics — timers, vault event subscription,
debounce — live in `app/` (`SyncScheduler`, `SyncQueue`) and make **no**
business decisions. The chain (`sync/SyncProjectAction`) orchestrates
provider-neutral steps; each mirror's half lives in its own module. Adapters
map raw provider payloads onto canonical DTOs **at the boundary**; the core
never sees a provider shape.

## 2. High-Level System Diagram

The vault is the origin of truth. GitHub (a repository plus a Projects v2
board) and Todoist are **mirrors**: they hold copies of a project's, task's
and to-do's title, body, status and completion, and the plugin keeps them
honest. Identity is a vault-owned uuid held in the registry
(`data.json`'s `syncState` container); filenames and frontmatter carry no
machine id.

```
                    ┌─────────────────────────────────────────────┐
                    │                  Obsidian                    │
                    │   ┌───────────┐        ┌─────────────────┐   │
   user edits ────► │   │  vault    │◄──────►│  SyncScheduler   │   │
   (notes)          │   │  notes    │        │  (poll + events) │   │
                    │   └─────┬─────┘        └────────┬────────┘   │
                    │         │ VaultPort             │ enqueue    │
                    │         ▼                       ▼            │
                    │   ┌───────────────────────────────────────┐  │
                    │   │             SyncQueue                 │  │
                    │   │   one serialized promise chain        │  │
                    │   └───────────────────┬───────────────────┘  │
                    │                       ▼                      │
                    │        ┌─────────────────────────────┐       │
                    │        │      SyncProjectAction       │       │
                    │        │  capture → resolve → cleanup │       │
                    │        │  → board → probe → lifecycle │       │
                    │        │  → renames → [GitHub half]   │       │
                    │        │  → vault consistency         │       │
                    │        │  → [Todoist half] → sweep    │       │
                    │        └───────┬───────────┬──────────┘       │
                    │                │           │                  │
                    │        SyncStatePort   (four provider-neutral │
                    │                │        ports in shared/)     │
                    └────────────────┼──────────────────────────────┘
                                     ▼
                         ┌───────────────────────┐
                         │  registry (data.json)  │
                         │  entities + mirror     │
                         │  items + per-port base │
                         └───────────────────────┘
              ┌──────────────────────┴──────────────────────┐
              ▼                                             ▼
   ┌──────────────────────┐                    ┌──────────────────────┐
   │  GitHub (mirror)      │                    │  Todoist (mirror)    │
   │  repo + Projects v2   │                    │  project + sections  │
   │  ProjectManagementPort│                    │  TaskManagerPort     │
   │  GraphQL + REST       │                    │  REST v1             │
   └──────────────────────┘                    └──────────────────────┘
```

**The pass.** Each tick, per project: resolve the work item against the vault
(a stale item no-ops) → strip legacy frontmatter → ensure the code-host board
exists for an active project (PRJ-1) → probe every project's cheap state →
reconcile the project lifecycle into one freeze verdict → recover renames →
run the GitHub half (gated by the probe, the full-scan marker and outward
drift) → run the vault-consistency step (checklist ⇄ to-do notes) → run the
Todoist half (gated by the freeze verdict) → sweep deletions. Every step is
wrapped in `step()`, so one failure logs and skips that step without blocking
the others. Before the per-project pass, the scheduler runs
`CaptureRemoteProjectsAction`, so a project born on a remote exists as a vault
folder before its chain reads it.

Per mirror, per field: fetch remote → map to canonical live view → read the
vault live view → read that mirror's base → three-way diff → apply verdicts
through the writer → advance that mirror's base only after its writes succeed.
The decision ladder resolves every conflict (decisive timestamp; then
done-beats-open; then origin authority) so no field is ever left undecided.

## 3. Core Components

For each module: name, primary responsibility, key technologies, deployment
target. Everything ships inside one Obsidian plugin bundle (`main.js`),
desktop-only.

| Module | Responsibility | Key classes |
|---|---|---|
| `app/` | Driving side and composition root | `ProjectManagementPlugin` (`main.ts`), `SyncScheduler`, `SyncQueue`, `PromoteToTaskCommand`, `PromoteCardToIssueCommand`, `PluginSettingTab` |
| `sync/` | The chain and its neutral step contracts | `SyncProjectAction`, `SyncHalves` (`CodeHostSyncHalf`, `TaskManagerSyncHalf`), `ProbeProjectsAction`, `DetectNoteRenamesAction`, `HandleDeletedNoteAction`, `CleanupNoteFrontmatterAction` |
| `github/` | The code-host mirror | `SyncGithubTasksAction`, `GitHubAdapter`, `ApplyTaskToGithubAction`, `GithubTaskMapper` |
| `todoist/` | The task-manager mirror | `SyncTodoistTasksAction`, `TodoistAdapter`, `ApplyTaskToTodoistAction`, `ApplyTodoistRemoteChangesAction`, `ApplyTodoistCompletionAction`, `CaptureTodoistCreationsAction`, `PropagateTodoistDeletionsAction`, `EnsureTodoistSectionsAction`, `TodoistTaskMapper` |
| `vault/` | The Obsidian vault | `VaultAdapter`, `TaskNoteMapper`, `TaskNoteParser`, `ToDoNoteMapper`, `ToDoNoteParser`, `CapturedTaskNoteMapper`, `Checklist` |
| `registry/` | The sync-state registry | `SyncStateAdapter`, `SyncStateSchema`, `SyncStateMigrations`, `loadDataSafely`, `ensureEntity`, `parentUuid` |
| `projects/` | Project lifecycle | `DiscoverProjectsAction`, `AttachProjectAction`, `EnsureProjectBoardAction`, `ReconcileProjectLifecycleAction`, `CaptureRemoteProjectsAction`, `BoardStatusAction`, `ProjectMapper` |
| `tasks/` | Task-note actions | `CreateTaskNoteAction`, `ApplyTaskToVaultAction`, `CompleteTaskCascadeAction`, `PropagateStatusAction`, `PromoteIssueAction`, `PromoteCardAction` |
| `todos/` | To-do notes | `SyncChecklistAction`, `MirrorTodoStatusAction`, `RelinkRenamedTodoAction` |
| `shared/` | The kernel | the four ports, canonical DTOs (`TaskData`, `ToDoData`, `ProjectData`, `RemoteProjectData`), `VerdictResolver`, `Reconciliation`, `toDiffView`, pure helpers |

### Ports & adapters

Each port is the **core need** it serves (never the tool's API it wraps),
lives in `shared/`, and is implemented by an adapter registered from the
adapter's own module. A component reaching around a port is a defect.

- **`SyncStatePort`** — *the core needs to remember identity, location and
  the last-synced shape per mirror.* Project-nested, port-grouped storage:
  one entity per hub (uuid + notePath), one item per mirror (handle + base),
  plus per-port state (provider, lastPoll, lanes) and per-project identity,
  archive, watch and full-scan state, and the per-surface project-capture
  cursors. Adapter: **`SyncStateAdapter`** (registry/), backed by
  `data.json`.
- **`VaultPort`** — *the core needs to read, create, write and rename notes
  by path, subscribe to note events, and enumerate project notes.* Adapter:
  **`VaultAdapter`** (vault/), backed by Obsidian's `app.vault`.
- **`ProjectManagementPort`** — *the core needs the code host's identity
  resolution, one whole-project detail fetch (issues + board cards), viewer
  boards, issue creation, board status/membership and project open/close.*
  Adapter: **`GitHubAdapter`** (github/), talking GitHub GraphQL + REST
  through an injected `Transport`.
- **`TaskManagerPort`** — *the core needs to mirror the vault's projects,
  tasks and to-dos into a personal task manager*: resolve/create/rename/
  archive a project, read/create/rename sections, read active and completed
  tasks, create/update/move/complete/delete a task, ensure a derived label.
  Adapter: **`TodoistAdapter`** (todoist/), REST v1 through an injected
  transport.

**Writers, absorbers, registry.** The *writers* render a winning canonical
view onto a surface and then advance that mirror's base
(`ApplyTaskToVaultAction`, `ApplyTaskToGithubAction`,
`ApplyTaskToTodoistAction`). The *absorbers* pull remote-originated facts
into the vault (`ApplyTodoistRemoteChangesAction`,
`ApplyTodoistCompletionAction`, `CaptureTodoistCreationsAction`,
`CaptureRemoteProjectsAction`). The *registry* (`SyncStateAdapter`) is the
single writer of `data.json`: every method funnels through one promise-chain
mutex, and the settings save shares that chain through `mutateRoot`.

## 4. Data Stores

- **`data.json`** — the Obsidian plugin data file, written through
  `this.loadData`/`this.saveData`. Type: JSON document. Purpose: plugin
  settings **and** the sync-state registry. Settings keys: `githubToken`,
  `todoistToken`, `pollIntervalMinutes`, `doneOptionName`, `debounceSeconds`,
  `taskTemplatePath`, `todoTemplatePath`, and a per-plugin `lastPoll.*`
  marker. Registry container `syncState` (version 3):
  - `version` — schema version (a newer-than-known container loads
    read-only).
  - `projects.<projectName>`:
    - `identity` — `{ repoUrl, projectNodeId, statusFieldId, statusOptions }`
    - `lastProjectUpdate` — ISO timestamp of the last board fetch
    - `archive` — `{ archivedAt, closed }`
    - `watch` — `{ etag, cursor }` for the newest-issue reactivation watch
    - `entities.<uuid>` — `{ notePath }` (hub-side location only)
    - `ports.<portId>` — `{ provider, lastPoll, lanes, tags, items }`, where
      `items.<handle>` is `{ entityId, base }` (the per-mirror diff-view
      base)
  - `fullScanPending` — legacy container-level marker (now per project).
  - Per-surface project-capture cursors live alongside the projects.
  - `data.json.bak` — a throttled rolling backup taken before a registry
    overwrite; `data.json.corrupt-<stamp>` — a quarantined unparsable file.
- **The vault itself** — markdown notes on the user's filesystem: a project
  is a folder under `Projecten/` (or `Archief/` when archived) with a
  `_<name>.md` home note; a task is a note under its `taken/` folder; a
  to-do is a note under its `todos/` folder. This is the origin of truth,
  not a cache.

## 5. External Integrations / APIs

- **GitHub** — repository issues and Projects v2 boards. Integration:
  GraphQL over `POST /graphql` plus REST calls (`GET`/`PATCH`/`POST`) through
  a `Transport` the composition root builds (`src/main.ts`). Sits behind
  **`ProjectManagementPort`**.
- **Todoist** — projects, sections, tasks and completion. Integration: REST
  v1 through a token-bound transport. Sits behind **`TaskManagerPort`**.
- **Obsidian** — the host application (vault API, plugin lifecycle,
  settings, notices). Sits behind **`VaultPort`** (the only module allowed
  to import the `obsidian` package is the adapter that implements it, plus
  the composition root).

## 6. Deployment & Infrastructure

- **Target**: an Obsidian community plugin. `pnpm run build` bundles the
  source with esbuild to `main.js`; `manifest.json` declares the plugin
  (`id: project-management`, `minAppVersion: 1.9.0`, `isDesktopOnly: true`).
  The bundle and manifest are copied into a scratch vault's
  `.obsidian/plugins/project-management/`.
- **CI/CD**: GitHub Actions.
  - `tests.yaml` — on push to `main` and every PR: `pnpm install`,
    `pnpm run typecheck`, `pnpm run lint`, `pnpm run lint:boundaries`,
    `pnpm test`, `pnpm run build`.
  - `changelog.yaml` — on push to `main`, delegates to the org
    changelog workflow.
  - `automatic-updates.yaml` — Dependabot/agent updates on PRs.
  - `opencode-agent.yaml` — the org opencode agent on issue comments.
- **Monitoring/logging**: none remote. The plugin logs through Obsidian and
  surfaces user-facing failures as `Notice`s; a per-step `step()` wrapper
  isolates a failure to its step. There is no telemetry and no server.

## 7. Security Considerations

- **Authentication**: a GitHub fine-grained PAT (Issues read/write, Projects
  read/write) and a Todoist API token, entered by the user in plugin
  settings. Both are persisted in `data.json` (plugin settings), which lives
  on the user's machine; treat the vault's plugin data as a secret.
- **Transport**: the composition root adds the `Authorization: Bearer`
  header in one place (`request()` / `getConditional()` in `src/main.ts`);
  the adapters are **token-agnostic** and never read settings themselves.
  All traffic is HTTPS via Obsidian's `requestUrl`.
- **Authorization boundary**: the GitHub half only acts on issues carrying a
  `type:*` label; untyped issues and drafts are ignored until a person
  explicitly promotes them (PRO-3). Promotion is the hand-turned override.
- **Registry safety**: a corrupt `data.json` is quarantined, never silently
  reset; a container written by a newer plugin version loads **read-only**
  and refuses to mutate, so a downgrade cannot rewrite the newer schema in
  the old shape. Writes persist through a fresh read of the root so settings
  and registry cannot clobber each other.
- **Boundary as security posture**: provider vocabulary is confined by the
  boundary gate, so a future provider cannot reach into another provider's
  code or the neutral core.

## 8. Development & Testing Environment

- **Local setup**: `direnv allow` (the `devshell` submodule of
  [devshell-node](https://github.com/99linesofcode/devshell-node), via
  `.envrc` → `use flake ./devshell`) provides `nodejs_22` and `pnpm`. Then
  `pnpm install`. Never develop in the main vault — use a scratch dev vault
  (`README.md`).
- **Build**: esbuild via `scripts/build.mjs` (`pnpm run build`,
  `pnpm run dev` for watch).
- **Testing**: Vitest (`pnpm test`). Tests mirror `src/`, arranged as
  behavioral Given/When/Then scenarios mapped to stable scenario IDs
  (DISC…PRB); fakes prove logic (`tests/helpers/fakeSyncState.ts`,
  `syncStateConformance.ts`).
- **Code quality**: TypeScript strict (`tsc --noEmit`), ESLint flat config
  with `eslint-plugin-boundaries` and prettier.
- **Mechanical gates**:
  - `boundaries/dependencies` — the module matrix (see §12) plus each
    provider's **public surface**. Any edge not explicitly allowed fails the
    build, so the matrix is acyclic by construction and a provider's
    internals cannot leak.
  - `boundaries/no-unknown-files` / `no-unknown-dependencies` — a new
    top-level module cannot slip in unclassified; every local import must
    resolve to an element.
  - `lint:boundaries` — a content grep proving provider vocabulary
    (`GitHub`/`Github`/`Todoist`) appears only in provider modules and the
    composition root.
  - **The double-sync invariance flagship**
    (`tests/sync/SyncProjectAction.invariance.test.ts`) — two consecutive
    sync passes, the second writes nothing (SYNC-8). This makes a
    non-idempotent pass impossible.
  - **The completion invariant** — `status === doneLane` iff
    `completedAt !== null` (COM-4), enforced by the writers and the tests.

## 9. Future Considerations / Roadmap

**Known architectural debt / open items.**

- The root `README.md` still describes the old `src/App/`, `src/Domain/`,
  `src/Infrastructure/` hexagonal layout; the code is now module-first with
  role suffixes (`src/{app,sync,github,todoist,vault,registry,projects,tasks,todos,shared}`).
  The README's architecture paragraph should be updated to match.
- `docs/developer-manual.md` §5 records four places where the code and the
  original brief still disagree (pass order, absorber order, deletion order,
  rename routing). The code is the described truth; the brief should be
  reconciled.
- `ProjectManagementPort` still exposes the older
  `fetchTrackedIssues`/`fetchBoardItems` pair alongside the canonical
  `fetchProjectDetail`; the older methods survive for the promote UI and the
  task-manager projection and are candidates for retirement.
- `tests/helpers/fakeSyncState.ts` and `syncStateConformance.ts` are the
  registry's conformance harness; keep them in step with `SyncStateSchema`.

**Deliberate non-goals** (from the identity-model spec §2 — decisions, not
omissions):

- **No second mirror adapter** (TickTick/Things/Asana). The ports make a new
  task manager additive, but none is built here; the registry's generic
  `provider`/`lanes`/`tags` fields exist for that future, not for a
  half-built provider.
- **No conflict-surfacing UI.** The decision ladder resolves every conflict
  with a rule (origin authority as fallback); showing a conflict to the user
  is a later slice, not a gap in this one.
- **No mass rename of existing note files.** Filenames keep their current
  form; identity lives in the registry, so a rename is never required.
- **No change to scheduler/queue routing.** The project-name-via-path-prefix
  routing stands.

## 10. Project Identification

Project Name: obsidian-project-management

Repository URL: https://github.com/99linesofcode/obsidian-project-management

Primary Contact/Team: Jordy Schreuders (99linesofcode)

Date of Last Update: 2026-10-06

## 11. Glossary / Acronyms

- **Origin / vault** — the Obsidian vault; the system of record. A note wins
  over a remote unless the remote provably changed more recently.
- **Mirror** — GitHub or Todoist; a remote holding a copy of vault work.
- **Hub / entity** — one piece of work (project, task, to-do), keyed by a
  vault-owned **uuid**; its registry record is `{ id, notePath }`.
- **Handle** — the entity's address in one mirror (a GitHub issue URL, a
  Todoist task id). Stored on the mirror item, keyed by handle.
- **Base** — the last-synced shape of one mirror, stored as a **diff view**;
  the third input to the three-way diff.
- **Diff view** — a canonical view whose body field carries the body's FNV-1a
  digest instead of the full text (`toDiffView`); all diffing and base
  storage operate on diff views.
- **Pass / tick** — one run of the chain. **Chain** — `SyncProjectAction`.
- **Half** — one mirror's part of the chain: `CodeHostSyncHalf` (GitHub) or
  `TaskManagerSyncHalf` (Todoist).
- **Writer** — an action that renders a winning canonical view onto a mirror
  and advances its base.
- **Absorber** — an action that pulls a remote-originated fact into the vault.
- **Capture** — pulling a remote-born project or item into the vault.
- **Adoption** — materializing a vault note from an untracked, typed remote
  issue.
- **Outward materialization** — creating a remote issue/twin from a new vault
  note, registry-first (the registry write precedes the remote call).
- **Promotion** — the explicit user act that applies a type label to an
  untyped issue or converts a draft card, past the type gate.
- **Slice** — a goal tracked on the board only; never a Todoist twin.
- **Lane** — the stage of work: a board column and its matching Todoist
  section.
- **Probe gate** — the cheap-state check that skips the expensive fetch when
  the board is unmoved, the vault has not drifted, and there is no outward
  drift.
- **Reopen veto** — a pull that would move a done note off the done lane is
  vetoed when the mirror's own state field disagrees with its lane.
- **Freeze verdict** — the single archive decision applied to folder, board
  and Todoist project.
- **Watermark / cursor** — the per-surface project-capture clock; only
  projects created strictly after it are captured.
- **Echo stamp** — the base advance that marks our own write so the next poll
  does not read it as a remote change.
- **Two axes** — the naming rule: the file-name suffix locates the
  architectural role, the prefix names the domain concept.
- **DTO** — Data Transfer Object; one canonical shape per domain concept,
  owned by the core.

## 12. Conventions & Boundaries

Enforced by `eslint-plugin-boundaries` (elements = the module folders) and
the `lint:boundaries` vocabulary grep — a naming standard without a gate
erodes one change at a time.

- **Folder structure**: module-first, lowercase; the path locates the
  module, the name locates the role. No layer folders (`domain/`,
  `infrastructure/`); a role folder appears inside a module only when a
  second file of that role exists.
- **File naming**: PascalCase classes with role suffixes
  (`SyncProjectAction`, `GitHubAdapter`, `VaultPort`, `TodoistTaskMapper`);
  camelCase pure functions, one per file (`toDiffView.ts`, `freePath.ts`).
  ES6 classes, one class per file, comments explain **why**.
- **Entry point**: `src/main.ts` — above the modules, never inside one. The
  `app` element also owns it.
- **Dependency matrix** (from `eslint.config.js`; any unlisted edge fails):
  - `shared` imports **nothing** — it is the kernel; the ports and their
    DTOs live there so no provider shape leaks into neutral ground.
  - `github` and `todoist` never import each other; the halves meet only
    through `shared` and `sync`.
  - `app` is the composition root and may import every module.
  - The domain/orchestration edges are the real ones: `vault`, `tasks`,
    `todos`, `projects`, `registry`, `sync` — the matrix is acyclic by
    construction.
  - Each provider module exposes a **public surface** (the adapter, the
    half, the writer, the transport DTO where the app needs it); every other
    file inside it is private.
- **Provider neutrality**: provider names appear only in provider modules
  and the composition root; shared and cross-cutting vocabulary is neutral
  (`remote`, `mirror`, `code host`, `task manager`). Backed by
  `lint:boundaries`.
- **Canonical DTOs**: one canonical shape per domain concept, owned by the
  core (`TaskData`, `ToDoData`, `ProjectData`, `RemoteProjectData`).
  Diff/merge logic operates on canonical fields only; the raw provider shape
  never crosses a port. A DTO mimicking a provider's structure is a provider
  shape, whatever its file name.
- **Ports own the core need**: every port in `shared/` states the core need
  it serves, not the tool's API; adapters register from their own module.
- **Documentation surfaces**: WHY comments at the change site; the developer
  manual (`docs/developer-manual.md`) updated when a flow changes; the
  behavioral contract (`planning/opm-identity-model/scenarios.md`) amended
  only by the owner.
