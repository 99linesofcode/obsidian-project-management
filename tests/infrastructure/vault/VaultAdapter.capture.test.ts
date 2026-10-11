import { describe, expect, it, vi } from 'vitest';

const { TFile } = vi.hoisted(() => {
  class TFile {
    stat: { mtime: number };
    constructor(
      public path: string,
      public extension: string,
      stat?: { mtime: number },
    ) {
      this.stat = stat ?? { mtime: 0 };
    }
  }
  return { TFile };
});

vi.mock('obsidian', () => ({ TFile }));

type TFileInstance = InstanceType<typeof TFile>;

import type { App } from 'obsidian';
import { AdoptedProject } from '../../../src/core/application/data/AdoptedProject.js';
import { CapturedProject } from '../../../src/core/application/data/CapturedProject.js';
import type { VaultAdapter } from '../../../src/infrastructure/vault/VaultAdapter.js';
import { connectionsOf } from '../../../src/infrastructure/vault/connectionsOf.js';
import { vaultAdapter } from '../../helpers/vaultAdapter.js';

class FakeAppVault {
  private readonly notes = new Map<string, string>();

  readonly metadataCache = {
    getFileCache: (file: { path: string }) => ({
      frontmatter: {
        connections: connectionsOf(this.notes.get(file.path) ?? ''),
      },
    }),
  };

  seed(path: string, content: string): void {
    this.notes.set(path, content);
  }

  has(path: string): boolean {
    return this.notes.has(path);
  }

  content(path: string): string | null {
    return this.notes.get(path) ?? null;
  }

  getAbstractFileByPath(path: string): TFileInstance | null {
    return this.notes.has(path) ? new TFile(path, 'md') : null;
  }

  getMarkdownFiles(): TFileInstance[] {
    return [...this.notes.keys()].map((path) => new TFile(path, 'md'));
  }

  getFolderByPath(): object | null {
    return {};
  }

  async createFolder(): Promise<void> {}

  async read(file: TFileInstance): Promise<string> {
    return this.notes.get(file.path)!;
  }

  async create(path: string, content: string): Promise<void> {
    this.notes.set(path, content);
  }

  async modify(file: TFileInstance, content: string): Promise<void> {
    this.notes.set(file.path, content);
  }
}

function adapter(notes: FakeAppVault): VaultAdapter {
  const app = {
    vault: notes,
    metadataCache: notes.metadataCache,
  } as unknown as App;
  return vaultAdapter(app, {
    registeredApplications: new Set(['github', 'todoist']),
  });
}

function captured(name: string, target: string): CapturedProject {
  return new CapturedProject({
    name,
    targets: [target],
    createdAt: '2026-10-05T10:00:00Z',
  });
}

describe('VaultAdapter — adopting a captured project', () => {
  it('writes a home note declaring the connection envelope', async () => {
    const notes = new FakeAppVault();

    await adapter(notes).adoptProject(captured('New Project', 'P-new'), 'todoist', 'todoist');

    expect(notes.has('Projecten/New Project/_New Project.md')).toBe(true);
    expect(notes.content('Projecten/New Project/_New Project.md')).toBe(
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
    const notes = new FakeAppVault();
    notes.seed('Projecten/New Project/_New Project.md', 'existing');

    await adapter(notes).adoptProject(captured('New Project', 'P-new'), 'todoist', 'todoist');

    expect(notes.content('Projecten/New Project/_New Project.md')).toBe(
      'existing',
    );
  });

  it('lists every adopted project connection as the dedup index', async () => {
    const notes = new FakeAppVault();
    notes.seed(
      'Projecten/Acme Widgets/_Acme Widgets.md',
      [
        '---',
        'connections:',
        '  github:',
        '    tool: github',
        '    project: "https://github.com/acme/widgets"',
        '---',
      ].join('\n'),
    );
    notes.seed(
      'Projecten/New Project/_New Project.md',
      [
        '---',
        'connections:',
        '  todoist:',
        '    tool: todoist',
        '    project: "P-new"',
        '---',
      ].join('\n'),
    );

    expect(await adapter(notes).listAdoptedProjects()).toEqual([
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
