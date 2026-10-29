import { describe, expect, it } from 'vitest';
import { SeedVaultArtifactsAction } from '../../../../src/core/application/actions/SeedVaultArtifactsAction.js';
import { SEED_ARTIFACTS } from '../../../../src/core/application/actions/templates.js';
import { DEFAULT_SETTINGS } from '../../../../src/ui/settings/settings.js';
import type { ProjectManagementSettings } from '../../../../src/core/application/data/ProjectManagementSettings.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';

class FakeVault extends FakeVaultBase {
  notes = new Map<string, string>();
  folders = new Set<string>();
  created: Array<{ path: string; content: string }> = [];

  override async getNoteByPath(
    path: string,
  ): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  override async createNote(path: string, content: string): Promise<void> {
    const segments = path.split('/');
    segments.pop();
    let folder = '';
    for (const segment of segments) {
      folder = folder === '' ? segment : `${folder}/${segment}`;
      this.folders.add(folder);
    }
    this.notes.set(path, content);
    this.created.push({ path, content });
  }

  override async writeNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  override async renameNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  async moveFolder(): Promise<void> {}
  override async listNotesInFolder(): Promise<never> {
    throw new Error('not used in this test');
  }
  async modifiedTime(): Promise<never> {
    throw new Error('not used in this test');
  }
  override async trashNote(): Promise<never> {
    throw new Error('not used in this test');
  }
  override async findProjectNotes(): Promise<never> {
    throw new Error('not used in this test');
  }
  override onNoteChanged(): void {}
  override onNoteDeleted(): void {}
  override onNoteRenamed(): void {}
}

function settings(
  overrides: Partial<ProjectManagementSettings> = {},
): ProjectManagementSettings {
  return { ...DEFAULT_SETTINGS, ...overrides };
}

const TASK_TEMPLATE = [
  '---',
  'affiliation: []',
  'status:',
  'synced:',
  'created: {{date}}',
  'categories:',
  '  - "[[Tasks.base|Tasks]]"',
  'tags: []',
  '---',
  '',
].join('\n');

const PROJECT_TEMPLATE = [
  '---',
  'affiliation: []',
  'created: {{date}}',
  'categories:',
  '  - "[[Projects.base|Projects]]"',
  'tags: []',
  '---',
  '',
  '## Notities',
  '![Notes](Notes.base#byAffiliation)',
  '',
  '## Meetings',
  '![Meetings](Meetings.base#byAffiliation)',
  '',
].join('\n');

const TASKS_BASE = [
  'filters:',
  '  and:',
  '    - file.ext == "md"',
  '    - list(categories).contains(link("Tasks.base"))',
  '    - \'!file.inFolder("Templates")\'',
  'formulas:',
  '  kind: note.labels.filter(value.startsWith("type:")).map(value.replace("type:", "")).join(", ")',
  'properties:',
  '  formula.kind:',
  '    displayName: Type',
  '  file.name:',
  '    displayName: Taak',
  'views:',
  '  - type: table',
  '    name: All',
  '    order:',
  '      - status',
  '      - file.name',
  '    sort:',
  '      - property: file.name',
  '        direction: ASC',
  '      - property: title',
  '        direction: ASC',
  '  - type: table',
  '    name: byAffiliation',
  '    filters:',
  '      and:',
  '        - list(affiliation).contains(this)',
  '    order:',
  '      - file.name',
  '    sort:',
  '      - property: status',
  '        direction: ASC',
  '',
].join('\n');

const PROJECTS_BASE = [
  'filters:',
  '  and:',
  '    - file.ext == "md"',
  '    - list(categories).contains(link("Projects.base"))',
  '    - \'!file.inFolder("Templates")\'',
  'properties:',
  '  note.type:',
  '    displayName: Type',
  '  file.name:',
  '    displayName: Project',
  '  note.created:',
  '    displayName: Aangemaakt op',
  'views:',
  '  - type: table',
  '    name: All',
  '    order:',
  '      - file.name',
  '      - created',
  '    sort:',
  '      - property: formula.link',
  '        direction: ASC',
  '      - property: title',
  '        direction: ASC',
  '  - type: table',
  '    name: byAffiliation',
  '    filters:',
  '      and:',
  '        - list(affiliation).contains(this)',
  '    order:',
  '      - file.name',
  '    sort:',
  '      - property: formula.link',
  '        direction: ASC',
  '      - property: title',
  '        direction: ASC',
  '',
].join('\n');

const SEEDED: Array<[string, string]> = [
  ['Templates/Task.md', TASK_TEMPLATE],
  ['Templates/Project.md', PROJECT_TEMPLATE],
  ['Bases/Tasks.base', TASKS_BASE],
  ['Bases/Projects.base', PROJECTS_BASE],
];

describe('TDO-2 — a fresh vault gets four artifacts', () => {
  it('creates the four artifacts at their default paths', async () => {
    const vault = new FakeVault();

    await new SeedVaultArtifactsAction(vault, settings()).execute();

    expect(vault.created.map((entry) => entry.path).sort()).toEqual(
      SEEDED.map(([path]) => path).sort(),
    );
    expect(vault.created).toHaveLength(4);
  });

  it('creates no to-do template and no Todos base', async () => {
    const vault = new FakeVault();

    await new SeedVaultArtifactsAction(vault, settings()).execute();

    expect(vault.notes.has('Templates/ToDo.md')).toBe(false);
    expect(vault.notes.has('Bases/Todos.base')).toBe(false);
  });

  it('writes each artifact verbatim, with the literal {{date}} unresolved', async () => {
    const vault = new FakeVault();

    await new SeedVaultArtifactsAction(vault, settings()).execute();

    for (const [path, content] of SEEDED) {
      expect(vault.notes.get(path)).toBe(content);
    }
    expect(vault.notes.get('Templates/Task.md')).toContain('created: {{date}}');
    expect(vault.notes.get('Templates/Project.md')).toContain(
      'created: {{date}}',
    );
  });
});

describe('seed — an existing artifact is never overwritten', () => {
  it('creates nothing when all four already exist', async () => {
    const vault = new FakeVault();
    for (const [path] of SEEDED) {
      vault.notes.set(path, 'hand-authored, deliberately different');
    }

    await new SeedVaultArtifactsAction(vault, settings()).execute();

    expect(vault.created).toEqual([]);
    for (const [path] of SEEDED) {
      expect(vault.notes.get(path)).toBe(
        'hand-authored, deliberately different',
      );
    }
  });

  it('creates only the missing artifacts when some exist', async () => {
    const vault = new FakeVault();
    vault.notes.set('Templates/Task.md', 'existing task template');
    vault.notes.set('Bases/Tasks.base', 'existing tasks base');

    await new SeedVaultArtifactsAction(vault, settings()).execute();

    expect(vault.created.map((entry) => entry.path).sort()).toEqual([
      'Bases/Projects.base',
      'Templates/Project.md',
    ]);
    expect(vault.notes.get('Templates/Task.md')).toBe('existing task template');
    expect(vault.notes.get('Bases/Tasks.base')).toBe('existing tasks base');
  });
});

describe('seed — the configured paths win', () => {
  it('seeds at a non-default path and leaves the default untouched', async () => {
    const vault = new FakeVault();

    await new SeedVaultArtifactsAction(
      vault,
      settings({
        taskTemplatePath: 'Templates/MijnTaken.md',
        projectsBasePath: 'Bases/My/Projects.base',
      }),
    ).execute();

    expect(vault.notes.get('Templates/MijnTaken.md')).toBe(TASK_TEMPLATE);
    expect(vault.notes.has('Templates/Task.md')).toBe(false);
    expect(vault.notes.get('Bases/My/Projects.base')).toBe(PROJECTS_BASE);
    expect(vault.notes.has('Bases/Projects.base')).toBe(false);
  });
});

describe('seed — parent folders', () => {
  it('creates the missing Templates and Bases folders', async () => {
    const vault = new FakeVault();

    await new SeedVaultArtifactsAction(vault, settings()).execute();

    expect(vault.folders.has('Templates')).toBe(true);
    expect(vault.folders.has('Bases')).toBe(true);
  });
});

describe('seed — on-demand scaffold', () => {
  it('scaffolds only the requested artifact', async () => {
    const vault = new FakeVault();

    await new SeedVaultArtifactsAction(vault, settings()).executeOne(
      'tasksBase',
    );

    expect(vault.created.map((entry) => entry.path)).toEqual([
      'Bases/Tasks.base',
    ]);
    expect(vault.notes.get('Bases/Tasks.base')).toBe(TASKS_BASE);
  });

  it('is idempotent — a second scaffold creates nothing', async () => {
    const vault = new FakeVault();
    const action = new SeedVaultArtifactsAction(vault, settings());

    await action.executeOne('taskTemplate');
    await action.executeOne('taskTemplate');

    expect(vault.created.map((entry) => entry.path)).toEqual([
      'Templates/Task.md',
    ]);
  });
});

describe('seed — the artifact list stays in sync with the settings', () => {
  it('names a settings path for every artifact', () => {
    for (const artifact of SEED_ARTIFACTS) {
      expect(DEFAULT_SETTINGS[artifact.settingKey]).toBeTruthy();
    }
  });
});
