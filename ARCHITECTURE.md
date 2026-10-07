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
│   ├── app/          # driving side: plugin lifecycle, scheduler, queue, commands, modals, settings
│   ├── github/       # code-host provider: adapter, mapper, sync half, writer
│   ├── todoist/      # task-manager provider: adapter, mapper, sync half, writers, absorbers
│   ├── vault/        # the vault adapter and the note mappers/parsers
│   ├── projects/     # discovery, attach, board creation, lifecycle, remote capture
│   ├── registry/     # the data.json-backed SyncStatePort adapter and schema
│   ├── tasks/        # task actions: the vault writer, cascade, promote, status
│   ├── todos/        # checklist ⇄ to-do note consistency
│   ├── sync/         # the chain, the two halves, the probe, renames, deletion sweep
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
(`Reconciliation`, `VerdictResolver`, `toDiffView`). Delivery mechanics — the
scheduler, the queue, timers — belong to `app/` and make no business
decisions. Persistence is owned by the registry adapter; nothing else touches
`data.json`.

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
                  │  probe → two halves →   │
                  │  three-way verdict      │
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

The pass is provider-neutral at its centre: the chain orchestrates the two
halves through narrow contracts, and the composition root supplies the concrete
provider actions. A provider's name never appears in the chain.

## 3. Core Components

| Component | Responsibility | Technology | Target |
|---|---|---|---|
| `src/main.ts` | The composition root: plugin lifecycle, settings load, wiring, startup discovery and remote-project capture | host plugin API | the vault |
| `src/app/` | Driving side: `SyncScheduler` (delivery mechanics), `SyncQueue` (one serialized chain), promotion commands/modals, settings tab and schema, the SecretStorage-backed token store, and the vault-artifact and type-label seed actions | host plugin API, `Component` | the vault |
| `src/sync/` | The chain: `SyncProjectAction` composes the halves; `SyncHalves` are the half contracts; the probe, rename recovery, frontmatter cleanup and deletion sweep | TypeScript | in-process |
| `src/github/` | The code-host provider: `GitHubAdapter`, `GithubTaskMapper`, `SyncGithubTasksAction` (the code-host half), `ApplyTaskToGithubAction` (the code-host writer) | GraphQL + REST | the code host |
| `src/todoist/` | The task-manager provider: `TodoistAdapter`, `TodoistTaskMapper`, `SyncTodoistTasksAction` (the task-manager half), the writer and the absorbers | REST v1 | the task manager |
| `src/vault/` | The origin adapter and the note mappers/parsers (`VaultAdapter`, `TaskNoteMapper`/`Parser`, `ToDoNoteMapper`/`Parser`, `CapturedTaskNoteMapper`, `Checklist`, the connections-block codec) | host vault API | the vault |
| `src/projects/` | Project discovery, attach, board creation, lifecycle freeze, remote capture and the project mapper | TypeScript | in-process |
| `src/registry/` | The `SyncStatePort` adapter and its schema | `data.json` | the vault |
| `src/tasks/` | Task actions: the vault writer, note creation, the completion cascade, promote, status propagation | TypeScript | in-process |
| `src/todos/` | Checklist ⇄ to-do note consistency in both directions | TypeScript | the vault |
| `src/shared/` | The kernel: the four ports, canonical DTOs, `Reconciliation`, `VerdictResolver`, `SyncVerdict` and the pure helpers | TypeScript | in-process |

### Ports & adapters

The core owns four provider-neutral ports, all in `src/shared/`. Each states
the **core need** it serves, never the tool's API it wraps; the adapter
registers from its own module.

- **`ProjectManagementPort`** — the core's need for a code host: resolve a
  project note's repository/board identity, fetch the whole project (issues
  with bodies + board cards with lanes) in one round trip, probe every project
  cheaply, read and update a single issue, set its open/closed state, lock its
  conversation, drive the board (cards, Status, membership), list the viewer's
  boards (each with its linked repositories) for the capture, and watch a
  repository's newest issue through a conditional read. Adapter:
  `GitHubAdapter`.
- **`TaskManagerPort`** — the core's need for a personal task mirror: resolve,
  create, rename and archive a project; read and create its lane sections;
  read its active and completed tasks; create, update, move, complete and
  delete a task; ensure a derived label. Adapter: `TodoistAdapter`.
- **`VaultPort`** — the core's need for the origin: read, create, write and
  rename notes by path; move folders; enumerate notes under a folder; read a
  note's modified time; trash a note (never a permanent delete); enumerate the
  project notes; and subscribe to note change/delete/rename events. Adapter:
  `VaultAdapter`.
- **`SyncStatePort`** — the core's need for memory: one entity per hub and one
  base item per mirror, grouped under the port that owns it, plus identities,
  watch state, the per-project full-scan marker and the per-surface project
  cursors. Adapter: `SyncStateAdapter`.

A component that reaches around a port is a defect. The provider modules never
import each other; the two sync halves meet only through `shared/` and `sync/`.

The API tokens are not settings and not a port: they live in Obsidian's
SecretStorage behind `SecretStorageAdapter` (`src/app/settings/`), which the
composition root reads at adapter construction and the settings tab sets and
clears. `data.json` is secret-free.

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
  shares with the settings save.
- **`main.js`** — the built bundle; never authored.

No other persistent store. The mirrors hold copies, never authority.

## 5. External Integrations / APIs

- **Code host** — GraphQL for the whole-project read (issues plus board
  cards), issue creation and the board operations; REST for the conditional
  watch read (ETag / 304) and the label and state updates. Behind
  `ProjectManagementPort`; a fine-grained token, bearer.
- **Task manager** — REST v1 for projects, sections, tasks and labels. Behind
  `TaskManagerPort`; an API token, bearer.
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
    `shared/` imports from no module; provider modules never import each
    other; neutral modules consume the kernel and the ports that live in it,
    never a provider adapter directly; the composition root wires everything.
    An unlisted import edge fails the lint, so the dependency graph stays
    acyclic and the kernel stays neutral.
  - **`boundaries/no-unknown-files`** and **`no-unknown-dependencies`** —
    every source file must belong to an element and every local import must
    resolve to one, so a new top-level module cannot slip in unclassified.
  - **`pnpm run lint:boundaries`** — a vocabulary grep: provider names
    (`GitHub`, `Github`, `Todoist`) may appear only in their own provider
    module and the composition root, so shared and cross-cutting vocabulary
    stays neutral.
  - **`pnpm run typecheck`** — strict tsc; a class of runtime bugs becomes a
    compile error.
  - **`pnpm test`** — behavioral tests per module, including the sync chain's
    invariance test.

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

**Known debt / open items:** `ProjectManagementPort` still carries
`fetchTrackedIssues` / `fetchBoardItems` alongside the canonical
`fetchProjectDetail`, kept for the promote UI until it migrates to the
canonical read. The developer manual records the remaining code-vs-brief
discrepancies.

## 10. Project Identification

Project Name: obsidian-project-management

Repository URL: https://github.com/99linesofcode/obsidian-project-management

Primary Contact/Team: Jordy Schreuders (99linesofcode)

Date of Last Update: 2026-10-07

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
  registry-first.
- **Capture** — adopting a remote-born project into the vault, guarded by a
  per-surface creation cursor. The home note is born with the connection
  envelope: a task-manager-born project declares a todoist connection, a
  board-born project a github connection derived from the board's single linked
  repository. Zero or several linked repositories is a collected error, never a
  silent capture; the home note declares only the connection envelope.

## 12. Conventions & Boundaries

The house standards this repository adheres to — stated here in full.
Enforced by `eslint-plugin-boundaries` (elements = the module folders) and the
`lint:boundaries` vocabulary grep:

- **Folder structure**: module-first, lowercase; the path locates the module,
  the name locates the role.
- **File naming**: PascalCase classes with role suffixes (`*Action`,
  `*Adapter`, `*Port`, `*Mapper`, `*Data`, `*Parser`); camelCase pure
  functions, one per file (`toDiffView.ts`, `projectHomePath.ts`). Tests
  mirror the tree: `tests/<module>/…`.
- **Entry point**: `src/main.ts` — above the modules, never inside one; the
  composition root.
- **Dependency matrix**: `shared/` imports from no module; the provider
  modules (`github`, `todoist`) never import each other; neutral modules
  consume the kernel and the ports that live in it, never a provider adapter
  directly; the composition root wires everything; no circular module
  dependencies.
- **Provider neutrality**: provider names appear only in provider modules and
  the composition root; shared and cross-cutting vocabulary is neutral (a
  provider name is a value argument, never a namespace key). Enforced by the
  `lint:boundaries` grep.
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
