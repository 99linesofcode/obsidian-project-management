// The six vault-owned artifacts the plugin assumes exist: the three note
// templates and the three Bases files. Seeding writes these verbatim when the
// configured path is genuinely absent — the literal `{{date}}` stays
// unresolved, because Obsidian's core Templates (or the plugin's own fill)
// resolves it at note-creation time, not at seed time.
//
// The contents are the contract the plugin's note mappers and the Bases views
// read; they are pre-approved seed data, not a place to redesign.

export type SeedPathKey =
  | 'projectTemplatePath'
  | 'taskTemplatePath'
  | 'todoTemplatePath'
  | 'projectsBasePath'
  | 'tasksBasePath'
  | 'todosBasePath';

export type SeedArtifactKey =
  | 'projectTemplate'
  | 'taskTemplate'
  | 'todoTemplate'
  | 'projectsBase'
  | 'tasksBase'
  | 'todosBase';

export interface SeedArtifact {
  key: SeedArtifactKey;
  // The settings field that holds this artifact's vault path.
  settingKey: SeedPathKey;
  label: string;
  description: string;
  content: string;
}

// A single trailing newline after the closing `---` (or the last body line)
// matches the hand-authored templates this seed replaces.
const TASK_TEMPLATE = `---
affiliation: []
status:
synced:
created: {{date}}
categories:
  - "[[Tasks.base|Tasks]]"
tags: []
---
`;

const TODO_TEMPLATE = `---
affiliation: []
status: open
completed:
created: {{date}}
categories:
  - "[[Todos.base|Todos]]"
tags: []
---
`;

const PROJECT_TEMPLATE = `---
affiliation: []
created: {{date}}
categories:
  - "[[Projects.base|Projects]]"
tags: []
---

## Notities
![Notes](Notes.base#byAffiliation)

## Meetings
![Meetings](Meetings.base#byAffiliation)
`;

const TASKS_BASE = `filters:
  and:
    - file.ext == "md"
    - list(categories).contains(link("Tasks.base"))
    - '!file.inFolder("Templates")'
properties:
  note.type:
    displayName: Type
  file.name:
    displayName: Taak
views:
  - type: table
    name: All
    order:
      - status
      - file.name
    sort:
      - property: file.name
        direction: ASC
      - property: title
        direction: ASC
  - type: table
    name: byAffiliation
    filters:
      and:
        - list(affiliation).contains(this)
    order:
      - file.name
    sort:
      - property: status
        direction: ASC
`;

const TODOS_BASE = `filters:
  and:
    - file.ext == "md"
    - list(categories).contains(link("Todos.base"))
    - '!file.inFolder("Templates")'
properties:
  file.name:
    displayName: To-do
views:
  - type: table
    name: All
    order:
      - file.name
    sort:
      - property: status
        direction: ASC
      - property: file.name
        direction: ASC
  - type: table
    name: byAffiliation
    filters:
      and:
        - list(affiliation).contains(this)
    order:
      - status
      - file.name
    sort:
      - property: status
        direction: ASC
`;

const PROJECTS_BASE = `filters:
  and:
    - file.ext == "md"
    - list(categories).contains(link("Projects.base"))
    - '!file.inFolder("Templates")'
properties:
  note.type:
    displayName: Type
  file.name:
    displayName: Project
  note.created:
    displayName: Aangemaakt op
views:
  - type: table
    name: All
    order:
      - file.name
      - created
    sort:
      - property: formula.link
        direction: ASC
      - property: title
        direction: ASC
  - type: table
    name: byAffiliation
    filters:
      and:
        - list(affiliation).contains(this)
    order:
      - file.name
    sort:
      - property: formula.link
        direction: ASC
      - property: title
        direction: ASC
`;

export const SEED_ARTIFACTS: readonly SeedArtifact[] = [
  {
    key: 'taskTemplate',
    settingKey: 'taskTemplatePath',
    label: 'Task template',
    description:
      'Vault path to the template new task notes render from. {{date}} and {{time}} resolve to the sync stamp; url, status, synced and affiliation are filled by the sync. Falls back to the built-in frontmatter when the file is missing.',
    content: TASK_TEMPLATE,
  },
  {
    key: 'todoTemplate',
    settingKey: 'todoTemplatePath',
    label: 'To-do template',
    description:
      'Vault path to the template new to-do notes render from. {{date}} and {{time}} resolve to the sync stamp; affiliation, status and completed are filled by the sync. Falls back to the built-in frontmatter when the file is missing.',
    content: TODO_TEMPLATE,
  },
  {
    key: 'projectTemplate',
    settingKey: 'projectTemplatePath',
    label: 'Project template',
    description:
      'Vault path to the template new project notes render from. {{date}} resolves to the creation stamp; affiliation is filled by the sync. Falls back to the built-in frontmatter when the file is missing.',
    content: PROJECT_TEMPLATE,
  },
  {
    key: 'tasksBase',
    settingKey: 'tasksBasePath',
    label: 'Tasks base',
    description:
      'Vault path to the Bases file that lists task notes. Seeded with a starter view when the file is missing.',
    content: TASKS_BASE,
  },
  {
    key: 'todosBase',
    settingKey: 'todosBasePath',
    label: 'To-dos base',
    description:
      'Vault path to the Bases file that lists to-do notes. Seeded with a starter view when the file is missing.',
    content: TODOS_BASE,
  },
  {
    key: 'projectsBase',
    settingKey: 'projectsBasePath',
    label: 'Projects base',
    description:
      'Vault path to the Bases file that lists project notes. Seeded with a starter view when the file is missing.',
    content: PROJECTS_BASE,
  },
];
