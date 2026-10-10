import { describe, expect, it } from 'vitest';
import { AdoptedProject } from '../../../src/domain/data/AdoptedProject.js';
import { CapturedProject } from '../../../src/domain/data/CapturedProject.js';
import {
  VaultProjectCaptureAdapter,
  type CaptureVault,
} from '../../../src/infrastructure/vault/VaultProjectCaptureAdapter.js';

class FakeCaptureVault implements CaptureVault {
  readonly notes = new Map<string, string>();
  readonly created: string[] = [];
  projectNotes: Array<{
    projectName: string;
    connections: Record<string, { tool: string; project: string }>;
  }> = [];

  async getNoteByPath(path: string): Promise<{ content: string } | null> {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }

  async createNote(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
    this.created.push(path);
  }

  async findProjectNotes() {
    return this.projectNotes;
  }
}

function captured(name: string, target: string): CapturedProject {
  return new CapturedProject({
    name,
    targets: [target],
    createdAt: '2026-10-05T10:00:00Z',
  });
}

describe('VaultProjectCaptureAdapter — adopting a captured project', () => {
  it('writes a home note declaring the connection envelope', async () => {
    const vault = new FakeCaptureVault();
    const adapter = new VaultProjectCaptureAdapter(vault);

    await adapter.adopt(captured('New Project', 'P-new'), 'todoist', 'todoist');

    expect(vault.created).toEqual(['Projecten/New Project/_New Project.md']);
    expect(vault.notes.get('Projecten/New Project/_New Project.md')).toBe(
      [
        '---',
        'connections:',
        '  todoist:',
        '    tool: todoist',
        '    project: "P-new"',
        '---',
        '',
        '# New Project',
        '',
      ].join('\n'),
    );
  });

  it('does not re-create a project whose home note already exists', async () => {
    const vault = new FakeCaptureVault();
    const adapter = new VaultProjectCaptureAdapter(vault);
    vault.notes.set('Projecten/New Project/_New Project.md', 'existing');

    await adapter.adopt(captured('New Project', 'P-new'), 'todoist', 'todoist');

    expect(vault.created).toEqual([]);
    expect(vault.notes.get('Projecten/New Project/_New Project.md')).toBe(
      'existing',
    );
  });

  it('lists every adopted project connection as the dedup index', async () => {
    const vault = new FakeCaptureVault();
    vault.projectNotes = [
      {
        projectName: 'Acme Widgets',
        connections: {
          github: {
            tool: 'github',
            project: 'https://github.com/acme/widgets',
          },
        },
      },
      {
        projectName: 'New Project',
        connections: { todoist: { tool: 'todoist', project: 'P-new' } },
      },
    ];
    const adapter = new VaultProjectCaptureAdapter(vault);

    expect(await adapter.listAdopted()).toEqual([
      new AdoptedProject({
        projectName: 'Acme Widgets',
        application: 'github',
        target: 'https://github.com/acme/widgets',
      }),
      new AdoptedProject({
        projectName: 'New Project',
        application: 'todoist',
        target: 'P-new',
      }),
    ]);
  });
});
