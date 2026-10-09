# Project Management

An Obsidian plugin that turns your vault into the home of your projects and
tasks — and keeps them in sync with the tools you already use.

## Why

Project management tools are great at boards and notifications and terrible at
thinking. Your vault is great at thinking and terrible at boards. This plugin
is the bridge: your notes stay where your thinking lives, and the remote tools
receive faithful mirrors of what your notes say.

Today the bridge connects **GitHub** (repository + Projects board, for project
and issue management) and **Todoist** (for task management). It is built as a
set of adapters behind a fixed core, so more project- and task-management tools
can be added without changing how the vault works.

## What it does

- **Projects** — a project note in your vault declares one or more
  **connections** to external tools. A GitHub connection anchors a repository;
  the plugin derives the Projects board from that repository, so there is
  nothing to configure. A Todoist connection anchors a task-manager project.
  Creating, renaming, archiving and restoring a project in the vault drives the
  remote side.
- **Tasks** — a task note becomes a GitHub issue and a Todoist task. Edits,
  status changes and deletions propagate in both directions.
- **Todos** — small checklist-style notes sync to Todoist as tasks.
- **Reconciliation** — the plugin compares your notes against its last-synced
  snapshot and the remote state through a three-way diff. The vault wins unless
  a remote change is provably newer, so editing offline never destroys remote
  work and remote work never silently overwrites you.

## How to use it

Install the plugin, open its settings, and provide a GitHub fine-grained PAT
(Issues: read/write, Projects: read/write) and a Todoist API token. Tokens live
in Obsidian's SecretStorage, never in the plugin's `data.json`. Then create
notes — the plugin discovers them and does the rest.

On first run the plugin seeds six vault-owned artifacts at their configured
paths: three note templates and three Bases files. An existing file is never
overwritten, and the settings tab can scaffold a missing one on demand.

### Create a project

A project is a **folder** under `Projecten/` containing one home note that
declares a non-empty `connections` map. By convention the note is named after
the folder with an underscore prefix — `Projecten/My Project/_My Project.md`:

```yaml
connections:
  github:
    tool: github
    project: https://github.com/you/my-project
  todoist:
    tool: todoist
    project: P123456
```

Everything about this project lives in this folder.

Each key under `connections` is a **connection slug** you choose; `tool` selects
the adapter and `project` is the opaque value that tool interprets (a repository
URL for GitHub, a project id for Todoist). A project may hold two connections of
the same tool under distinct slugs — for example `todoist-work` and
`todoist-personal`.

The GitHub board is **derived from the repository**: the plugin adopts a board
already linked to the repo, prefers the one titled with the repo name when
several are linked, and creates one (with a Status field) when none exists.
There is no `board:` property to set.

The folder name is the project name — rename the folder and the plugin follows;
the note's own filename does not matter. Moving the folder to `Archief/<project>/`
archives the project; moving it back restores it.

### Create a task

A task note is any note whose frontmatter carries `type`, `status` and an
`affiliation` linking it to its project — for example
`Projecten/My Project/taken/Write the README.md`:

```yaml
categories: [taken]
type: task
status: Backlog
affiliation: '[[My Project]]'
created: 2026-10-06
synced: 2026-10-06T09:30:00
```

Everything this task needs to say. This body becomes the issue body.

- `type` is the content kind: `task`, `slice` (a sub-task nested under another
  note) or `bug`.
- `status` is your project's status option name, verbatim — change it here and
  the issue and board card follow.
- `affiliation` is a quoted wikilink list: the project first, then the parent
  note when the task is nested.

### Create a todo

A todo note is smaller: frontmatter with a `status` field makes it a todo,
`affiliation` attaches it to a project — for example
`Projecten/My Project/todos/Call the printer.md`:

```yaml
status: open
affiliation: '[[My Project]]'
```

```markdown
- [ ] order toner
- [ ] confirm delivery date
```

Todos sync to Todoist as tasks; checking them off in either place is
reflected in the other.

### Templates

You control what generated notes look like. Point the plugin at template files
in your vault (defaults: `Templates/Task.md` and `Templates/ToDo.md`) and it
renders new notes through them:

- the template's frontmatter is kept — your own fields (`categories`, `tags`,
  whatever you use) survive;
- fields the plugin manages (`type`, `status`, `affiliation`, `synced`, …) are
  filled in from the sync data;
- `{{date}}` and `{{time}}` resolve to the sync stamp;
- the template's body becomes the note body.

A missing or malformed template falls back to the built-in note shape shown
above, so the plugin works before you have written a single template.

## The architecture, in short

The plugin is a study in a few classic ideas, applied where they earn their
keep:

- **Hexagonal architecture (ports & adapters)** — the vault is the origin; each
  external tool sits behind a port (a small interface the core owns), and
  GitHub and Todoist are adapters implementing those ports. Adding a new
  project- or task-management tool means writing one adapter, not touching the
  core.
- **Modular monolith** — one plugin, internally divided into bounded modules
  (`core`, `infrastructure`, `app`, `projects`, `registry`, `sync`, `tasks`,
  `todos`, `vault`, `shared`), with a dependency matrix enforced by
  `eslint-plugin-boundaries` so modules cannot quietly reach into each other.
- **Pragmatic DDD** — canonical data shapes (one task shape across all
  providers), a `data.json` registry as the sync-state memory, and a pure
  reconciliation core that is tested without faking Obsidian.
- **Action objects** — every sync operation is its own small class with one
  public method, so the sync chain reads as a list of composable steps.

The full architecture is in [ARCHITECTURE.md](ARCHITECTURE.md); a flow-by-flow
developer manual is in [docs/developer-manual.md](docs/developer-manual.md).

## Development

```bash
pnpm install             # install dependencies
pnpm run build           # bundle the plugin to main.js (minified)
pnpm run dev             # watch and rebuild on change (with sourcemaps)
pnpm test                # run the test suite once
pnpm run lint            # eslint (flat config + prettier)
pnpm run lint:boundaries # provider-vocabulary boundary grep
pnpm run typecheck       # type-check without emitting
```

Built on [node-skeleton](https://github.com/99linesofcode/node-skeleton):
shared config flows via remote + rebase, pnpm runs inside the `devshell-node`
Nix devshell (`.envrc` → `use flake ./devshell`), esbuild bundles the plugin.
Never develop in your main vault — always use a scratch dev vault.

## Contributing

Please review the [Contribution Guidelines](https://github.com/99linesofcode/.github/blob/main/CONTRIBUTING.md).

## Code of conduct

In order to ensure that the community is welcoming to all, please review and abide by the [Code of Conduct](https://github.com/99linesofcode/.github?tab=coc-ov-file).

## Security vulnerabilities

Please review the [security policy](https://github.com/99linesofcode/.github?tab=security-ov-file) on how to report security vulnerabilities.

## License

This software is open source and licensed under the [MIT license](https://github.com/99linesofcode/.github?tab=MIT-1-ov-file).
