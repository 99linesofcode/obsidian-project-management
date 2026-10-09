# obsidian-project-management — Developer Manual

This manual walks every path through the source. It is written against the code,
not against the design brief: where the two disagree, the code is described and
the disagreement is called out in
[Code-vs-brief discrepancies](#5-code-vs-brief-discrepancies).

The engine is the multi-adapter core (`src/core/`) plus its driven adapters
(`src/infrastructure/`), wired by the composition root `src/main.ts`. The core
names no provider: it reconciles canonical fields across an origin and any
number of mirror sides through one pure N-way merge. A connection produces a
mirror side; the vault is the origin. The old chain — the two provider halves,
the pairwise verdict, the legacy writers — is gone; what remains around the core
is an orchestration shell (probe, board-ensure, rename recovery, vault
consistency, the deletion sweep), documented here as it exists.

---

## 1. Orientation

### What the plugin is

The vault is the origin of truth. A project is a folder under `Projecten/`
(or `Archief/` when archived) whose home note declares a non-empty
`connections` map — one entry per connection slug, `{ tool, project }`; a task
is a note under its `taken/` folder; a to-do is a note under its `todos/`
folder. GitHub (a repository plus a Projects v2 board) and Todoist are
**mirrors**: they hold copies of the vault's title, body, status and completion,
and the plugin keeps them honest. Identity is a vault-owned uuid held in the
registry (`data.json`'s `syncState` container); filenames and frontmatter carry
no machine id.

### The five core promises

1. **The vault is the origin of truth.** A note wins over a remote unless the
   remote provably changed more recently.
2. **No change is ever lost, and none is invented.** Every edit lands
   everywhere it should; nothing appears that nobody asked for.
3. **Deletion is deliberate and thorough.** Deleting a note removes its echoes
   everywhere. Deleting a twin on a remote never touches the note.
4. **Completion is sticky.** A completed task stays completed unless a person
   deliberately reopens it.
5. **Interruption is safe.** A stop at any moment recovers on the next start
   without losing or duplicating work.

### The cast

**The core (`src/core/`) names no provider.** It owns the capability
vocabulary, the canonical DTOs, the one pure N-way merge, the descriptor and
registrar, the mirror-sync action, the two pass assemblers and the reconcilers.

- **Capability ports.** `ProjectPort` (`project`, `lifecycle`),
  `TaskSurfacePort` (`identity`, `title`, `body`, `subtasks`, `completion`,
  `Status`, `label`), and the optional `CapturePort`, `ProjectCapturePort`,
  `CompleteFetchPort`, `TimestampedPort`, `TaskLockPort` (`task-locking`) and
  `ProjectActivityPort` (`project-activity`). An adapter implements only the
  groups its descriptor declares; an undeclared optional port is absent, so a
  capability an adapter lacks has no interface to call.
- **The origin ports.** `OriginPort` (observe/apply/trash a task note) and
  `ProjectLifecycleOriginPort` (observe/apply a project's archived state). The
  origin is a role, not an application: it gets no descriptor.
- **The setup port.** `ProjectSetupPort` (discover a target's projects, resolve
  addressing, create/adopt a project, list viewer projects, probe state) is the
  code-host adapter's surface for discovery, attach and board-ensure.
- **The supporting ports.** `ProjectSourcePort`, `BaselineStorePort`,
  `MirrorHandlePort`, `MirrorProjectPort`, `MirrorAdapterFactoryPort`,
  `ProjectCaptureCursorPort`, `ProjectCaptureVaultPort`, `TaskCaptureVaultPort`
  and `ProjectWatchPort`.
- **The vocabulary.** `Capabilities.ts` holds the fourteen capability names;
  `canonicalField.ts` holds the seven canonical fields (`identity`, `title`,
  `body`, `subtasks`, `completion`, `Status`, `label`).
- **The canonical DTOs.** `CanonicalTask`, `CanonicalProject`, `Baseline`,
  `SideObservation`, `OriginObservation`, `Delta`, `MergeResult`, `MirrorSide`,
  `MirrorSyncPass`, `PassRecord`, `ProjectLifecyclePass`,
  `ProjectLifecycleRecord`, `DeclaredConnection`, `ConnectionEnvelope`,
  `CanonicalFieldWrite`, `CapturedProject`, `AdoptedProject`, `ProjectSummary`,
  `ProjectCandidate`, `ProjectDiscovery`, `ProjectAddressing`, `ProjectState`
  and `ProjectActivityObservation`.
- **The pure merge.** `mergeField(origin, mirrors)` — no I/O, no clock, no
  randomness (see [§3](#3-the-decision-ladder)).
- **The descriptor and registrar.** `AdapterDescriptor` (application id,
  capabilities, per-field representations, secret keys, settings rows),
  `AdapterRegistration` and the pure `registerAdapters`, which validates and
  returns a `RegistrationResult` of `RegisteredAdapter`s.
- **The actions.** `MirrorSyncAction` (the one capability-parameterized
  reconcile), `AssembleProjectPassAction` (one whole-project task pass),
  `ProjectLifecycleSyncAction` + `AssembleProjectLifecyclePassAction` (the
  project-level peer), `CaptureProjectsAction`, `CaptureTasksAction`,
  `ReconcileProjectTaskLocksAction` and `ReactivateFrozenProjectAction`.

**The driven adapters (`src/infrastructure/`) implement those ports, one
namespace per application.**

- **Vault.** `VaultOriginAdapter` (`OriginPort`), `VaultProjectLifecycleAdapter`
  (`ProjectLifecycleOriginPort`), `VaultProjectSourceAdapter`
  (`ProjectSourcePort`), `VaultProjectCaptureAdapter`
  (`ProjectCaptureVaultPort`) and `VaultTaskCaptureAdapter`
  (`TaskCaptureVaultPort`).
- **GitHub.** `CodeHostMirrorAdapter` (the `MirrorAdapter` and
  `ProjectSetupPort`), `githubDescriptor`, `CodeHostTarget` and
  `CodeHostTransport`.
- **Todoist.** `TaskManagerMirrorAdapter` (the `MirrorAdapter`),
  `todoistDescriptor`, `TaskManagerTarget`, `TaskManagerTransport` and
  `TodoistTransport`.
- **Registry.** `CoreBaselineStoreAdapter` (`BaselineStorePort`),
  `RegistryMirrorHandleAdapter` (`MirrorHandlePort`),
  `RegistryMirrorProjectAdapter` (`MirrorProjectPort`),
  `RegistryProjectCursorAdapter` (`ProjectCaptureCursorPort`) and
  `CoreProjectWatchAdapter` (`ProjectWatchPort`).
- **Conformance.** `ConformanceMirrorAdapter` + `conformanceDescriptor` — an
  in-memory adapter, inert unless a project names its application id.

**The driving side and the orchestration shell.**

- **`SyncScheduler`** — delivery mechanics only. A poll interval and vault
  change/delete/rename events enqueue project names; renames bypass the
  debounce. Before each tick it runs the injected project capture, so a project
  born on a remote is captured before the per-project chain reads it. It makes
  no business decisions.
- **`SyncQueue`** — one serialized promise chain for the whole plugin. Runs one
  project at a time, coalesces duplicates, swallows a failed run so the queue
  never poisons.
- **`SyncProjectAction`** — the chain. One work item (a project folder name) and
  one entry point; it drives the core reconcilers through five injected
  interfaces (`TaskFieldReconciler`, `TaskCaptureReconciler`,
  `ProjectLifecycleReconciler`, `ProjectTaskLocksReconciler`,
  `ProjectReactivationReconciler`, all in `src/sync/`) and wraps every step so
  one failure logs and skips that step.
- **`main.ts`** — the composition root. `composePlugin` builds the vault
  adapter, the mirror-adapter factory, the setup adapter and the shell actions;
  `composeCoreReconcilers` lazily builds the core pass assemblers and their
  infrastructure peers.
- **`SyncStateAdapter`** — the registry (see [§2.9](#29-the-registry)).
- **`SeedVaultArtifactsAction`** — seeds the six vault-owned artifacts (three
  note templates, three Bases files) create-if-missing, on init and on demand
  from the settings tab.
- **The retained shell actions.** `ProbeProjectsAction`,
  `DetectNoteRenamesAction`, `SweepDeletedNotesAction`, `HandleDeletedNoteAction`,
  `MigrateProjectHomeNoteAction`, `RekeyRenamedConnectionsAction`,
  `DiscoverProjectsAction`, `AttachProjectAction`, `EnsureProjectBoardAction`,
  `CompleteTaskCascadeAction`, `SyncChecklistAction`, `MirrorTodoStatusAction`
  and `CreateTaskNoteAction`.

### The descriptor and the registrar

Each adapter module exports a typed `AdapterDescriptor`. The composition root
assembles a plain list of `AdapterRegistration`s and passes it to the neutral,
pure `registerAdapters`, which:

- rejects an application id that is not lowercase alphanumerics with dashes, a
  duplicate id, a descriptor missing a required field, an unknown capability, an
  unknown settings-row kind, or a descriptor missing the in-scope minimum
  surface (`UNIVERSAL_CAPABILITIES` + `MANDATORY_FIELD_CAPABILITIES`); and
- returns each accepted adapter as a `RegisteredAdapter`, exposing only the
  ports its descriptor declares (`capture`, `projectCapture`, `completeFetch`,
  `timestamps`, `taskLock`, `activity` are gated by capability).

`main.ts` builds the descriptors and gates each adapter through the neutral
`registerAdapters` — the GitHub and Todoist mirrors via `gateMirror`, the
conformance adapter in the stored registration; the kernel is not edited to add
an application. A provider name is a value argument, never a namespace key in
the core.

---

## 2. Sequence diagrams

Each diagram names the real classes and follows the actual call graph. A
one-paragraph summary precedes each.

### 2.1 The pass

On load, `SyncScheduler.tick` first runs the injected project capture
(`CaptureProjectsAction`, [§2.6](#26-project-capture)), then enumerates the
vault's project notes and enqueues each project name; `SyncQueue` runs them one
at a time. `SyncProjectAction.execute` re-resolves the project (a stale work
item no-ops), migrates a legacy home note, re-keys a renamed connection,
ensures a code-host board for each active github connection, probes the project,
reactivates a frozen project with newer mirror work, reconciles the lifecycle
into one freeze verdict, reconciles task locks on the transition, recovers
renames, runs the vault-consistency step, and — when not frozen — runs the core
task capture and the core task-field pass, then sweeps deletions. Every
`step()` failure logs and skips that step without blocking the others.

#### 2.1a Startup and the pre-tick capture

```mermaid
sequenceDiagram
  participant P as ProjectManagementPlugin
  participant D as DiscoverProjectsAction
  participant A as AttachProjectAction
  participant Cap as CaptureProjectsAction
  participant Sched as SyncScheduler
  participant Q as SyncQueue

  P->>D: execute() on layout ready
  D->>A: execute({ repoUrl }) per github connection
  A-->>D: ProjectIdentityData
  D->>P: projects and errors
  P->>P: syncState.setIdentity per project
  P->>Cap: projectCapture()
  Cap-->>P: { captured, errors }
  Note over Sched: next tick
  Sched->>Cap: captureProjects()
  Sched->>Q: enqueue(project) per project note and captured name
```

#### 2.1b The chain order

```mermaid
sequenceDiagram
  participant SP as SyncProjectAction
  participant Mig as MigrateProjectHomeNoteAction
  participant Rek as RekeyRenamedConnectionsAction
  participant Ens as EnsureProjectBoardAction
  participant Probe as ProbeProjectsAction
  participant React as ProjectReactivationReconciler
  participant Life as ProjectLifecycleReconciler
  participant Lock as ProjectTaskLocksReconciler
  participant Ren as DetectNoteRenamesAction

  SP->>SP: resolveProject (no-op when missing)
  SP->>Mig: execute(notePath, locationArchived)
  SP->>Rek: execute(connections)
  loop each active github connection
    SP->>Ens: execute(project, connectionSlug)
  end
  SP->>Probe: execute(github targets)
  SP->>React: reactivate(project)
  SP->>Life: reconcile(project)
  Life-->>SP: { frozen, wasFrozen }
  SP->>Lock: reconcile({ project, frozen, wasFrozen })
  SP->>Ren: execute({ projectName, syncedAt })
```

#### 2.1c The core reconcilers and the sweep

```mermaid
sequenceDiagram
  participant SP as SyncProjectAction
  participant Chk as SyncChecklistAction
  participant Cas as CompleteTaskCascadeAction
  participant Mir as MirrorTodoStatusAction
  participant TC as TaskCaptureReconciler
  participant TF as TaskFieldReconciler
  participant Sweep as SweepDeletedNotesAction

  SP->>SP: runVaultConsistency
  loop each taken note
    SP->>Cas: execute(notePath, projectName, syncedAt)
    SP->>Chk: execute(notePath, projectName, syncedAt)
  end
  loop each todos note
    SP->>Mir: execute(todoPath, syncedAt)
  end
  alt not frozen
    SP->>TC: capture(project, syncedAt)
    SP->>TF: reconcile(project)
  end
  loop each github connection
    SP->>Sweep: execute({ projectName, connectionSlug, application, target })
  end
```

The five reconciler interfaces are the cutover seam: `SyncProjectAction` holds
a `() => TaskFieldReconciler` (and the four peers), and `main.ts` fills each
with an adapter over the assembled core action. The lifecycle reconciler returns
`{ frozen, wasFrozen }`; when it throws, `SyncProjectAction` falls back to the
probe's `closed` fact and `note.archivedAt`.

### 2.2 The N-way merge (`mergeField`)

`mergeField` is the whole decision: it derives one `Delta` per side against that
side's own `Baseline`, then applies the ladder. It is pure — no I/O, no clock,
no randomness. Its inputs are `SideObservation`s (one origin, N mirrors); its
output is a `MergeResult` carrying the outcome, the winning value, the rung, the
deltas and the superseded deltas.

```mermaid
sequenceDiagram
  participant Caller as MirrorSyncAction or ProjectLifecycleSyncAction
  participant MF as mergeField
  participant D as Delta

  Caller->>MF: mergeField(origin, mirrors)
  MF->>D: deriveDelta(origin), deriveDelta(mirror) each
  alt no delta
    MF-->>Caller: unchanged, value = origin.current, rung 0
  else exactly one delta
    MF-->>Caller: that delta's outcome, rung 0
  else decisive timestamp (rung 1)
    MF-->>Caller: unique newest trustworthy time wins
  else completion over a stale open (rung 2)
    MF-->>Caller: the completion side wins
  else origin tie-break (rung 3)
    MF-->>Caller: origin.current, or delete when origin is absent
  end
```

Delta derivation (see [§3](#3-the-decision-ladder) for the rules): an origin
whose `current` is `null` with a baseline is a **delete** delta; a mirror's
absence is a delete only when it has a baseline **and** its adapter declares
`complete-fetch` and `fetchComplete()` returned true.

### 2.3 The mirror-sync action (`MirrorSyncAction`)

`MirrorSyncAction` names no provider. Given a `MirrorSyncPass`, it filters the
mirrors to those whose descriptor `represents` the field, observes each against
its own baseline, calls `mergeField` once, fans the reconciled value out through
the one generic write entry, and applies the same value to the origin. It
records the sides written, skipped, advanced and failed on a `PassRecord`. A
mirror write that throws is recorded in `failed` and fan-out continues to the
remaining mirrors, so one failing connection never abandons the rest.

```mermaid
sequenceDiagram
  participant A as AssembleProjectPassAction
  participant MS as MirrorSyncAction
  participant R as RegisteredAdapter
  participant MF as mergeField
  participant O as OriginPort

  A->>MS: invoke(pass)
  loop each capable mirror
    MS->>R: tasks.readTask(handle)
    MS->>R: timestamps.fieldTime(handle, field)
    MS->>R: completeFetch.fetchComplete()
  end
  MS->>MF: mergeField(origin, observations)
  alt outcome value
    loop each capable mirror
      MS->>R: readTask then applyField when it differs
    end
  else outcome delete
    loop each capable mirror
      MS->>R: readTask then deleteTask when it exists
    end
  end
  MS->>O: applyField or trash when the origin differs
  MS-->>A: PassRecord
```

A side is **advanced** when it was written or already matched; a skipped write
still advances (the repair path for a widened value); a failed write advances
nothing.

### 2.4 The project pass assembler (`AssembleProjectPassAction`)

`AssembleProjectPassAction.invoke` reads the project's declared connections and
its task-note paths, builds one mirror adapter per connection through
`MirrorAdapterFactoryPort`, resolves each note to that connection's own handle
through `MirrorHandlePort`, and runs `MirrorSyncAction` once per
(note, canonical field) over the six merged fields — `title`, `body`,
`subtasks`, `completion`, `Status`, `label`. A connection whose entity has no
resolved handle is **materialized**: the origin task is read through
`OriginPort.readTask` (a note without a `type` is not a task and is skipped), a
placeholder handle is recorded through the mirror-handle port before the item is
created through `TaskSurfacePort.createTask`, the real handle replaces the
placeholder, and the created mirror is reconciled in the same pass. A
placeholder left by an interrupted pass is **adopted** by matching the mirror's
task title rather than re-created, so a failed record never duplicates the item.

```mermaid
sequenceDiagram
  participant A as AssembleProjectPassAction
  participant PS as ProjectSourcePort
  participant F as MirrorAdapterFactoryPort
  participant H as MirrorHandlePort
  participant O as OriginPort
  participant R as RegisteredAdapter
  participant MS as MirrorSyncAction

  A->>PS: readConnections(project)
  A->>PS: listEntities(project)
  A->>F: create(application, target, slug, project) per connection
  loop each note path
    A->>H: resolve(slug, notePath)
    alt no handle or a pendingCreation placeholder
      A->>O: readTask(notePath)
      alt pending placeholder and a title match exists
        A->>R: tasks.readTasks(target), adopt by title
        A->>H: record(real handle)
      else
        A->>H: record(pendingCreation:<notePath>)
        A->>R: tasks.createTask(target, task)
        A->>H: record(created.handle)
      end
    end
    loop each merged field
      A->>MS: invoke(MirrorSyncPass)
      A->>A: persistAdvanced per advanced side
    end
  end
```

The side key is `mirror:<slug>` (`mirrorSideKey`), disjoint from the origin's
`origin` key, so a connection slug of `origin` cannot collide. Two connections
to the same application stay distinct sides. The pass persists each advanced
side's `Baseline` (value plus the completion flag) through `BaselineStorePort`.

### 2.5 The project lifecycle pass

`AssembleProjectLifecyclePassAction` is the project-level peer of the task pass.
It scopes the mirrors, resolves each connection's mirror project through
`MirrorProjectPort` — onboarding a missing one by `ProjectPort.createProject`
and recording the returned handle, so a newly-connected project is onboarded in
the same pass — renames a mirror project whose name drifted from the vault
project through `ProjectPort.renameProject`, reads the origin's archived state
through `ProjectLifecycleOriginPort`, runs the same `mergeField` ladder over the
archived fact, and fans the reconciled freeze out to the origin and every
capable mirror. Any side can start the freeze or the unfreeze; the reconciled
freeze is the pass's `frozen` verdict, which gates the task-field pass. Its
per-side baselines live under the `lifecycle` field in the same baseline store.

```mermaid
sequenceDiagram
  participant A as AssembleProjectLifecyclePassAction
  participant PS as ProjectSourcePort
  participant MP as MirrorProjectPort
  participant R as RegisteredAdapter
  participant O as ProjectLifecycleOriginPort
  participant LS as ProjectLifecycleSyncAction
  participant MF as mergeField

  A->>PS: readConnections(project)
  loop each connection
    A->>MP: resolve(project, slug)
    alt recorded
      A->>R: renameProject when the name drifted
    else readProject returns a project
      A->>MP: record(target)
    else
      A->>R: createProject(target, project)
      A->>MP: record(created.handle)
    end
  end
  A->>O: observeProject(project)
  A->>LS: invoke(ProjectLifecyclePass)
  LS->>MF: mergeField(origin, mirror observations)
  LS->>R: setArchived when the mirror differs
  LS->>O: applyProjectArchived when the origin differs
  LS-->>A: ProjectLifecycleRecord { frozen, wasFrozen }
```

`wasFrozen` is `pass.origin.baseline?.value === 'true'`; `frozen` is
`result.value === 'true'`. A mirror that exposes no archive time returns `null`
from `archivedTime`, so the ladder falls through to the vault tie-break.

### 2.6 Project capture (`CaptureProjectsAction`)

A capture-capable adapter enumerates the application-born projects it can see
(`ProjectCapturePort.captureProjects`), each carrying its name, its candidate
connection targets and its creation clock. The action reads each source's
projects in creation order, adopts every project after that source's stored
cursor that the vault does not already declare — writing the home note with its
connection envelope through `ProjectCaptureVaultPort` — and advances the cursor
only over the projects it handled. A first sight adopts the newest clock and
captures nothing, so installing the plugin against an account full of unrelated
projects adopts none of them. A project that links zero or several targets stops
the watermark with a collected error; an already-declared project is skipped, so
the pass is idempotent.

```mermaid
sequenceDiagram
  participant C as CaptureProjectsAction
  participant S as CaptureSource
  participant V as ProjectCaptureVaultPort
  participant Cur as ProjectCaptureCursorPort

  C->>S: capture.captureProjects()
  C->>V: listAdopted()
  C->>Cur: read(application)
  alt first sight (no cursor)
    C->>Cur: write(newest createdAt or syncedAt)
    Note over C: capture nothing
  else cursor exists
    loop projects after the cursor, oldest first
      alt already declared by name
        Note over C: handled, watermark may pass
      else exactly one target
        C->>V: adopt(project, application, slug)
      else zero or several targets
        Note over C: collect error, stop the watermark
      end
    end
    C->>Cur: write(last handled), only when it moved
  end
```

### 2.7 Task capture (`CaptureTasksAction`)

For each declared connection whose adapter declares `capture`, the core action
reads the tracked tasks the adapter can see (`CapturePort.capture`) — the issues
carrying a `type:` label — and adopts every task the vault does not already hold
as a task note. The whole listing is scanned each pass and the adopted mirror
items are skipped, so the pass is idempotent without a cursor. The vault sink
routes by the connection's application: a code-host issue through
`CreateTaskNoteAction`, a task-manager task through `CapturedTaskNoteMapper`. A
connection whose listing or adoption fails is collected and never stops the
later connections.

```mermaid
sequenceDiagram
  participant C as CaptureTasksAction
  participant PS as ProjectSourcePort
  participant F as MirrorAdapterFactoryPort
  participant R as RegisteredAdapter
  participant V as TaskCaptureVaultPort
  participant CT as CreateTaskNoteAction

  C->>PS: readConnections(project)
  loop each connection
    C->>F: create(application, target, slug, project)
    C->>R: capture.capture(target)
    C->>V: listAdopted(project, slug)
    loop each task not already adopted
      alt code host
        C->>V: adopt(input)
        V->>CT: execute(url, title, body, type, ...)
      else task manager
        C->>V: adopt(input)
        Note over V: CapturedTaskNoteMapper + freePath
      end
    end
  end
```

### 2.8 Task locks and reactivation

`ReconcileProjectTaskLocksAction` runs only on a freeze/unfreeze transition
(`frozen !== wasFrozen`). For each connection whose adapter declares
`task-locking`, it enumerates the project's tracked mirror items through
`MirrorHandlePort`, skips the tasks whose vault status is the done lane, and
locks the rest — or unlocks every tracked task on the unfreeze.

`ReactivateFrozenProjectAction` runs before the lifecycle pass. When the origin
was already frozen (its `lifecycle` baseline is `true`) and a capable mirror's
newest item provably postdates the stored watch cursor, it unfreezes the origin,
so the lifecycle pass fans the unfreeze out to every mirror. The first watch
adopts the newest item as the cursor; a quiet conditional read writes nothing.

```mermaid
sequenceDiagram
  participant SP as SyncProjectAction
  participant React as ReactivateFrozenProjectAction
  participant B as BaselineStorePort
  participant R as RegisteredAdapter
  participant W as ProjectWatchPort
  participant O as ProjectLifecycleOriginPort
  participant Lock as ReconcileProjectTaskLocksAction
  participant H as MirrorHandlePort

  SP->>React: reactivate(project)
  React->>B: read(project, lifecycle, origin)
  alt origin baseline frozen
    loop each connection with project-activity
      React->>W: read(project, slug)
      React->>R: activity.latestActivity(target, etag)
      alt first watch
        React->>W: write(etag, newest)
      else newer than the cursor
        React->>O: applyProjectArchived(project, false)
        React->>W: write(null, null)
      else
        React->>W: write(etag, cursor)
      end
    end
  end
  SP->>Lock: reconcile({ project, frozen, wasFrozen })
  loop each connection with task-locking
    Lock->>H: list(project, slug)
    Lock->>R: lockTask or unlockTask per handle
  end
```

### 2.9 The registry

`SyncStateAdapter` is the single writer of the `syncState` container. Every port
method funnels through a promise-chain mutex, so a command racing a sync pass
cannot interleave a load-modify-save. The first load reads the `syncState`
container, builds the in-memory indexes, and caches it. Ports are keyed by the
note's connection slug (not the provider name), so a project can hold two
connections of the same tool; discovery re-keys a renamed connection's port in
lockstep (`rekeyPortState`). Identities are keyed per connection
(`projects.<name>.identities.<connectionSlug>`), so two code-host connections
address their own repositories and boards. The container also carries the
per-surface project-capture cursors (`projectCursors`) beside the projects;
setting a cursor to its current value is a no-op. Every write persists through a
fresh read of the `data.json` root (so settings keys survive) after asking for a
throttled rolling backup. A container whose version is NEWER than this plugin's
is loaded read-only: reads serve it, but every mutating port method throws
("registry written by a newer plugin version — refusing to mutate"). A corrupt
`data.json` is quarantined by `loadDataSafely` before the adapter ever sees it.
The settings save shares this one chain through `mutateRoot`.

The core's own memory lives in two sibling top-level keys, written through the
same storage but not through `SyncStateAdapter`:

- **`coreBaselines`** (`CoreBaselineStoreAdapter`) — per entity, per
  `BaselineField` (a canonical field or `lifecycle`), per side, a `Baseline`
  (`value`, `completed`).
- **`coreWatches`** (`CoreProjectWatchAdapter`) — per project, per connection,
  the reactivation watch (`etag`, `cursor`).

```mermaid
sequenceDiagram
  participant Caller as any port caller
  participant A as SyncStateAdapter
  participant L as loadDataSafely
  participant S as data.json storage

  Caller->>A: port method
  A->>A: queue(fn), serialization mutex
  A->>L: load() on first use
  L-->>A: data, or quarantine on corrupt
  alt container version newer than VERSION
    A->>A: readOnly = true, no save
  end
  A->>A: buildIndexes and mutate
  A->>A: persist(): maybeBackup (throttled 60s), load fresh root, save
```

### 2.10 Settings save

Settings and the registry share `data.json` but are split so a settings save can
never revert the registry. At onload, `settingsFromData` copies the root and
deletes the `syncState` key, so the in-memory settings never carry a registry
snapshot. `saveSettings` calls `SyncStateAdapter.mutateRoot`, which runs on the
SAME promise chain as every registry write: it reads a fresh root, merges the
settings into it (`mergeSettingsIntoData` skips `syncState`), and persists.

```mermaid
sequenceDiagram
  participant Tab as ProjectManagementSettingTab
  participant P as ProjectManagementPlugin
  participant A as SyncStateAdapter
  participant S as settings.ts
  participant D as data.json

  Tab->>P: saveSettings()
  P->>A: mutateRoot(mergeSettingsIntoData)
  Note over A: runs on the registry's one promise chain
  A->>D: load() fresh root
  A->>S: merge settings, skipping syncState
  A->>D: save(merged)
```

### 2.11 Registration

The composition root builds the descriptors and passes the registrations to the
pure registrar. `gateMirror` reuses the same registrar to gate a single adapter
for the factory.

```mermaid
sequenceDiagram
  participant M as main.ts
  participant RA as registerAdapters
  participant D as AdapterDescriptor
  participant R as RegisteredAdapter

  M->>RA: registerAdapters([AdapterRegistration(descriptor, adapter), ...])
  loop each registration
    RA->>D: validate id, required fields, capabilities, rows, minimum surface
    alt rejected
      RA->>RA: collect RegistrationError
    else accepted
      RA->>R: gatePorts(descriptor, adapter)
    end
  end
  RA-->>M: RegistrationResult { adapters, errors }
```

`mirrorAdapterFactory.create` dispatches on the application id to
`CodeHostMirrorAdapter` or `TaskManagerMirrorAdapter` and gates the result;
`buildCaptureSources` gates the same two adapters once and collects their
`projectCapture` surfaces.

### 2.12 Vault consistency (retained shell)

The chain's vault-consistency step keeps the markdown checklist and the vault
to-do notes in step. `SyncChecklistAction` promotes an unlinked line to a new
to-do note, relinks a short or wrong-folder link, renames a drifted to-do,
follows the checkbox, and trashes a to-do whose line was removed.
`MirrorTodoStatusAction` runs the other direction: a to-do note's status updates
its parent task's checkbox. Both settle, so a second pass writes nothing.

```mermaid
sequenceDiagram
  participant SP as SyncProjectAction
  participant Chk as SyncChecklistAction
  participant Mir as MirrorTodoStatusAction
  participant V as VaultPort

  loop each taken note
    SP->>Chk: execute(notePath, projectName, syncedAt)
    Chk->>V: parseChecklist
    Chk->>V: promote unlinked, create to-do note
    Chk->>V: relink or rename or complete or reopen
    Chk->>V: removeDropped, trash orphan to-dos
  end
  loop each todos note
    SP->>Mir: execute(todoPath, syncedAt)
    Mir->>V: find parent task and checklist line
    Mir->>V: write checkbox to match to-do status
  end
```

### 2.13 Completion and the cascade (retained shell)

Done is one fact with one stamp. The invariant is `status === doneLane` if and
only if `completedAt !== null`. `CompleteTaskCascadeAction` is the vault-side
projection: when a task's status is the done lane it checks the task note's own
checklist lines, completes every still-open to-do the task owns, and checks the
task's own line in a parent slice's checklist. Reopen is asymmetric: the parent
slice line mirrors the status in both directions, but the to-dos are never
auto-reopened. The core's `completion` field carries the same fact to the
mirrors through `MirrorSyncAction`.

```mermaid
sequenceDiagram
  participant V as Vault note
  participant Cas as CompleteTaskCascadeAction
  participant Chk as SyncChecklistAction
  participant MS as MirrorSyncAction
  participant R as RegisteredAdapter

  Note over V,R: invariant status doneLane iff completedAt not null
  alt done in the vault
    Cas->>V: check own checklist lines
    Cas->>V: complete open to-dos
    Cas->>V: mirror parent slice line
    MS->>R: applyField(completion, true) and applyField(Status, lane)
  else done on a mirror
    MS->>V: origin applyField(completion, true)
    MS->>R: fan the reconciled value to the other mirrors
  end
```

### 2.14 Deletion propagation (retained shell, factory-backed)

A deleted note is swept by `SweepDeletedNotesAction`, which enumerates the
project's entities and, for each whose note is gone, calls
`HandleDeletedNoteAction`. That action finds the registry record by note path,
resolves the connection's mirror item through `SyncStatePort`, builds the
connection's adapter through `MirrorAdapterFactoryPort`, and calls
`TaskSurfacePort.deleteTask` (the GitHub adapter deletes the board card). When
the stored base lane is not the done lane it then applies
`completion = true` through the generic write entry, which closes the issue.
Finally it evicts the entity, dropping its remaining mirror items. Deletion
starts in the vault; a remote deletion is never honored as a deletion of record.

```mermaid
sequenceDiagram
  participant SP as SyncProjectAction
  participant Sweep as SweepDeletedNotesAction
  participant HD as HandleDeletedNoteAction
  participant SS as SyncStatePort
  participant F as MirrorAdapterFactoryPort
  participant R as RegisteredAdapter

  SP->>Sweep: execute({ projectName, connectionSlug, application, target })
  Sweep->>SS: listEntities(projectName)
  Sweep->>Sweep: records whose note is gone
  Sweep->>HD: execute({ notePath, ... })
  HD->>SS: findByNotePath, findMirrorItemByEntity
  HD->>F: create(application, target, connectionSlug, projectName)
  HD->>R: tasks.deleteTask(handle)
  opt base lane is not the done lane
    HD->>R: tasks.applyField(completion, true)
  end
  HD->>SS: removeEntity(id)
```

The reverse case: a twin deleted by hand whose note survives is not a deletion
of the note. The vault wins, and the projection recreates the twin in the same
tick.

### 2.15 Rename survival (retained shell)

A live rename event bypasses the debounce and enqueues the project immediately,
but the recovery itself is the same as an offline rename:
`DetectNoteRenamesAction` lists the current notes and the records, groups the
untracked notes by a recovery stem (the filename stem with a legacy ordinal
prefix stripped and lowercased, via `normalizedStem`), and moves each vanished
record's `notePath` to the same-stem note. The uuid and the mirrors are
untouched.

```mermaid
sequenceDiagram
  participant Sched as SyncScheduler
  participant Q as SyncQueue
  participant SP as SyncProjectAction
  participant Ren as DetectNoteRenamesAction
  participant V as VaultPort
  participant SS as SyncStatePort

  alt live rename
    V-->>Sched: onNoteRenamed(old, new)
    Sched->>Q: enqueue(project), no debounce
  else offline rename
    Note over Sched: next tick
  end
  Q->>SP: execute(project)
  SP->>Ren: execute({ projectName, syncedAt })
  Ren->>V: listNotesInFolder(taken and todos)
  Ren->>SS: listEntities(project)
  Ren->>Ren: untracked notes grouped by normalizedStem
  loop record whose note is gone
    Ren->>SS: setEntity(record with the same-stem note path)
  end
```

### 2.16 Discovery, attach and board-ensure (`ProjectSetupPort`)

At `onLayoutReady`, `DiscoverProjectsAction` enumerates the vault's project
notes and attaches each GitHub connection through `AttachProjectAction`, which
uses `ProjectSetupPort.discoverProjects` to resolve the repository and its
boards, `deriveBoardChoice` to pick one, and `readProjectAddressing` to resolve
the Status field and its options. A board that does not exist yet yields an
identity with an empty `projectNodeId`, which `EnsureProjectBoardAction`
resolves later on the chain: it adopts a linked board, prefers the one titled
with the repo name, creates one (with a Status field) when none exists, and
adopts an unlinked same-name viewer board (the orphan of an interrupted
creation) rather than duplicating it. The identities are persisted so later
board operations can resolve them.

```mermaid
sequenceDiagram
  participant P as ProjectManagementPlugin
  participant D as DiscoverProjectsAction
  participant A as AttachProjectAction
  participant Setup as ProjectSetupPort
  participant Ens as EnsureProjectBoardAction
  participant SS as SyncStatePort

  P->>D: execute()
  D->>A: execute({ repoUrl })
  A->>Setup: discoverProjects(repoUrl)
  A->>A: deriveBoardChoice(repoName, boards)
  alt a board exists
    A->>Setup: readProjectAddressing(board)
  else no board
    Note over A: identity with empty projectNodeId
  end
  A-->>D: ProjectIdentityData
  D->>SS: setIdentity(projectName, connectionSlug, identity)
  Note over Ens: chain, active github connection
  Ens->>Setup: discoverProjects(repoUrl), listProjects()
  Ens->>Setup: createProjectWithStatus or adoptProject
  Ens->>SS: setIdentity(merged)
```

---

## 3. The decision ladder

`mergeField(origin, mirrors)` is pure: no I/O, no clock, no randomness. It runs
in two stages.

**Stage 1 — attribution (`deriveDelta`).** For each side, compare the side's
current canonical value with its own baseline:

- current equals baseline → no delta;
- current differs (or there is no baseline) → a `value` delta carrying the
  current value, the side's field time and whether it is completed;
- current is `null` with a baseline → a `delete` delta. The origin's absence is
  always a delete; a mirror's absence is a delete only when its adapter declares
  `complete-fetch` and `fetchComplete()` returned true (a verified-complete
  fetch), so an adapter that cannot prove a full listing never deletes on
  absence.

**Stage 2 — resolution.** With the deltas collected:

1. **No delta.** `unchanged`; the value is the origin's current value.
2. **Exactly one delta.** That delta wins at rung 0; its kind is the outcome.
3. **Rung 1 — decisive timestamp.** Consider only trustworthy deltas with a
   non-null time. The newest must be unique, and every other delta must be
   trustworthy, have a time, and be strictly older. Then the newest wins. A
   non-trustworthy or timeless side blocks the rung, so the ladder falls
   through.
4. **Rung 2 — completion over a stale open.** Among value deltas, if at least
   one is a completion and at least one is an open, there are no deletes, the
   origin is not itself an open delta, and all completions carry the same value,
   the completion wins. (The origin's own open state blocks the rung, so a
   completion never overrides a deliberate vault reopen.)
5. **Rung 3 — origin authority.** The origin wins. If the origin's current
   value is `null`, the outcome is `delete`; otherwise it is `value` with the
   origin's value. This is the fallback for every remaining multi-sided
   conflict, including both-done `Status` conflicts (which differ only in lane
   cosmetics).

The invariant: after `mergeField`, every multi-sided conflict has a winner, so
no field is left undecided. The collapsed outcome drives the fan-out; the
origin's absence is a delete delta, and the origin's edit time is trusted by
default (the origin side sets `timestampTrustworthy: true`).

The reopen veto the old pairwise verdict applied on the pull path is subsumed:
the GitHub adapter keeps the completion fact separate from the `Status`
representation, and `completion` is merged as its own field, so a stale board
lane can no longer revert a completion.

---

## 4. Invariants cheat-sheet

- **Base advances only after durable writes.** `MirrorSyncAction` records a
  side as advanced only after its write resolves (or when it already matched);
  `AssembleProjectPassAction.persistAdvanced` then writes the `Baseline`. A
  failed write is recorded in `failed` and advances nothing. A skipped write
  still advances: the side already matched the reconciled value, which is the
  repair path for a widened value.
- **A fact from one mirror never moves another's base.** Each side is compared
  against its own baseline; the reconciled value is fanned out to every capable
  mirror, and each side's baseline advances independently.
- **A mirror's absence is a delete only with a verified-complete fetch.** An
  adapter without `complete-fetch` (or whose `fetchComplete()` is false) never
  yields a delete from absence, so a partial listing cannot delete a mirror
  item.
- **The origin's absence is a delete.** The origin side always has
  `completeFetch: true`; a missing origin task with a baseline is a delete
  delta, and rung 3 produces `delete` when the origin is absent.
- **The origin's edit time is trusted by default.** `originSideObservation`
  sets `timestampTrustworthy` from the origin observation, which the vault
  adapters set to `true`.
- **Completion is sticky.** Rung 2 lets a completion beat a stale open, and
  rung 3 falls back to the origin, so an open origin is never overridden by a
  mirror's completion; a deliberate vault reopen holds.
- **The completion fact is separate from the Status representation.** The
  canonical `completion` field carries done-ness; `Status` carries the lane. A
  both-done conflict resolves by origin authority without collapsing the two.
- **Flatten before delete (retained shell).** A slice twin is retired by moving
  every direct child to the top level, awaiting the moves, and only then
  deleting the twin; a failed flatten aborts before the delete and retries next
  tick.
- **Registry writes are serialized.** Every `SyncStateAdapter` port method and
  the settings save run on one promise chain, so a load-modify-save can never
  interleave. A container written by a newer plugin version is read-only.
- **A quiet tick writes nothing.** Setting a project cursor to its current
  value is a no-op; a lifecycle or task side that already matches is advanced
  without a remote write.
- **The `coreBaselines` and `coreWatches` keys are siblings of `syncState`.**
  The core's memory is separate from the shell's per-mirror bases, so a write on
  one cannot clobber the other.

---

## 5. Code-vs-brief discrepancies

These are places where the code and the design brief (ADR 001) disagree. The
code is documented above; the brief's version is recorded here.

1. **The orchestration shell is retained, not fully replaced.** ADR 001 says the
   legacy halves, the old pure verdict and the legacy writers are deleted (they
   are), and describes the chain as running the core reconcilers. It does — but
   `SyncProjectAction` still orchestrates through the legacy `VaultPort` and
   `SyncStatePort`, still branches on `connection.tool === 'github'`, and still
   runs the board-ensure, probe, vault-consistency (cascade, checklist, to-do
   mirror) and deletion-sweep steps. The five core reconcilers are injected
   seams; the surrounding shell is legacy scaffolding. The ADR's "the chain
   builds the origin and the per-connection mirror adapters" is accurate, but the
   surrounding steps are not core.
2. **`HandleDeletedNoteAction` is the remaining old-port consumer.** It builds
   the connection's adapter through the core `MirrorAdapterFactoryPort` and
   writes through `TaskSurfacePort`, but it still finds the record and the
   mirror item through the legacy `SyncStatePort`. The ADR names it as the
   remaining old-port consumer; that is still true.
3. **The probe result is only a fallback.** `SyncProjectAction.probe` runs
   `ProbeProjectsAction` and passes the `ProjectStateData` into
   `reconcileLifecycle`, but the lifecycle reconciler ignores it; the probe's
   `closed` fact is used only when the lifecycle reconciler throws. The primary
   freeze verdict comes from the core lifecycle pass.
4. **`identity` is declared but not reconciled by the task pass.** The
   `identity` canonical field and capability exist, and `MirrorSyncAction`'s
   `canonicalValue` supports it, but `AssembleProjectPassAction` merges only
   `title`, `body`, `subtasks`, `completion`, `Status` and `label`. Identity is
   carried by the registry's mirror items, not merged as a field.
5. **The scheduler's pre-tick capture is injected, not owned.** `SyncScheduler`
   invokes an optional `captureProjects` callback and enqueues its returned
   names; `main.ts` wires that callback to `projectCapture()`. The scheduler
   itself makes no decision about what the capture does.

---

## 6. Where to start reading

The tree is module-first; each module owns one surface of the system.

- The wiring and construction order: `src/main.ts` (`onload`, `composePlugin`,
  `composeCoreReconcilers`, `mirrorAdapterFactory`).
- The core engine: `src/core/` (`mergeField`, `MirrorSyncAction`,
  `AssembleProjectPassAction`, `AssembleProjectLifecyclePassAction`,
  `ProjectLifecycleSyncAction`, `registerAdapters`, `AdapterDescriptor`, the
  ports under `src/core/ports/`, the DTOs under `src/core/data/`).
- The capture and lifecycle reconcilers: `src/core/CaptureProjectsAction.ts`,
  `CaptureTasksAction.ts`, `ReconcileProjectTaskLocksAction.ts`,
  `ReactivateFrozenProjectAction.ts`.
- The driven adapters: `src/infrastructure/` (`vault/`, `github/`, `todoist/`,
  `registry/`, `fake/`).
- The chain and the shell: `src/sync/` (`SyncProjectAction`,
  `ProbeProjectsAction`, `DetectNoteRenamesAction`, `SweepDeletedNotesAction`,
  `HandleDeletedNoteAction`, the five reconciler interfaces).
- The registry: `src/registry/` (`SyncStateAdapter`, `SyncStateSchema`,
  `loadDataSafely`).
- The projects module: `src/projects/` (`DiscoverProjectsAction`,
  `AttachProjectAction`, `EnsureProjectBoardAction`, `deriveBoardChoice`,
  `MigrateProjectHomeNoteAction`, `RekeyRenamedConnectionsAction`).
- The vault: `src/vault/` (`VaultAdapter`, `ToDoNoteMapper`/`ToDoNoteParser`);
  the task-note codecs live with their consumers
  (`src/core/TaskNoteMapper.ts`, `src/infrastructure/vault/CapturedTaskNoteMapper.ts`).
- The driving side: `src/app/` (`SyncScheduler`, `SyncQueue`, the settings
  module, `SeedVaultArtifactsAction`).
