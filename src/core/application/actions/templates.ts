import type { VaultPort } from '../../port/VaultPort.js';

export async function readTemplate(
  vault: VaultPort,
  path: string,
): Promise<string | null> {
  const note = await vault.getNoteByPath(path);
  return note?.content ?? null;
}

export type SeedPathKey =
  | 'projectTemplatePath'
  | 'taskTemplatePath'
  | 'projectsBasePath'
  | 'tasksBasePath';

export type SeedArtifactKey =
  | 'projectTemplate'
  | 'taskTemplate'
  | 'projectsBase'
  | 'tasksBase';

export interface SeedArtifact {
  key: SeedArtifactKey;
  settingKey: SeedPathKey;
  label: string;
  description: string;
  content: string;
}

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
formulas:
  kind: note.labels.filter(value.startsWith("type:")).map(value.replace("type:", "")).join(", ")
properties:
  formula.kind:
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
    key: 'projectsBase',
    settingKey: 'projectsBasePath',
    label: 'Projects base',
    description:
      'Vault path to the Bases file that lists project notes. Seeded with a starter view when the file is missing.',
    content: PROJECTS_BASE,
  },
];
