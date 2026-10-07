import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('obsidian', () => {
  class Component {
    load(): void {
      this.onload();
    }
    onload(): void {}
    registerInterval(id: number): number {
      return id;
    }
  }
  return { Component };
});

import { SyncScheduler } from '../../src/app/SyncScheduler.js';
import type { SyncQueue } from '../../src/app/SyncQueue.js';
import type { ProjectNoteData } from '../../src/shared/ProjectNoteData.js';
import type { VaultPort } from '../../src/shared/VaultPort.js';

class FakeVault implements VaultPort {
  modifiedTimes = new Map<string, string>();

  async modifiedTime(path: string): Promise<string | null> {
    return this.modifiedTimes.get(path) ?? null;
  }
  noteChangedCb: ((path: string) => void) | null = null;
  noteDeletedCb: ((path: string) => void) | null = null;
  noteRenamedCb: ((oldPath: string, newPath: string) => void) | null = null;
  projectNotes: ProjectNoteData[] = [];

  async getNoteByPath(): Promise<null> {
    return null;
  }
  async createNote(): Promise<void> {}
  async writeNote(): Promise<void> {}
  async renameNote(): Promise<void> {}
  async moveFolder(): Promise<void> {}
  async listNotesInFolder(): Promise<string[]> {
    return [];
  }
  async trashNote(): Promise<void> {}
  async findProjectNotes(): Promise<ProjectNoteData[]> {
    return this.projectNotes;
  }
  onNoteChanged(cb: (path: string) => void): void {
    this.noteChangedCb = cb;
  }
  onNoteDeleted(cb: (path: string) => void): void {
    this.noteDeletedCb = cb;
  }
  onNoteRenamed(cb: (oldPath: string, newPath: string) => void): void {
    this.noteRenamedCb = cb;
  }
  fireNoteChanged(path: string): void {
    this.noteChangedCb?.(path);
  }
  fireNoteDeleted(path: string): void {
    this.noteDeletedCb?.(path);
  }
  fireNoteRenamed(oldPath: string, newPath: string): void {
    this.noteRenamedCb?.(oldPath, newPath);
  }
}

class FakeQueue {
  enqueued: string[] = [];
  enqueue(project: string): void {
    this.enqueued.push(project);
  }
}

function projectNote(
  projectName: string,
  archivedAt: string | null,
): ProjectNoteData {
  return {
    path: `${archivedAt !== null ? 'Archief' : 'Projecten'}/${projectName}/_home.md`,
    projectName,
    archivedAt,
    connections: {
      github: { tool: 'github', project: 'https://github.com/acme/widgets' },
    },
    connectionErrors: [],
  };
}

function schedulerWith(
  vault: FakeVault,
  queue: FakeQueue,
  debounceMs = 0,
  capture?: () => Promise<string[]>,
): SyncScheduler {
  return new SyncScheduler(
    vault,
    queue as unknown as SyncQueue,
    60_000,
    debounceMs,
    capture,
  );
}

describe('PRB-1 — quiet means cheap, never blind', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('enqueues every discovered project, archived ones included, on each tick', async () => {
    const vault = new FakeVault();
    vault.projectNotes = [
      projectNote('Acme Widgets', null),
      projectNote('Other', null),
      projectNote('Old Project', ''),
    ];
    const queue = new FakeQueue();
    schedulerWith(vault, queue).load();

    await vi.advanceTimersByTimeAsync(60_000);

    expect(queue.enqueued).toEqual(['Acme Widgets', 'Other', 'Old Project']);
  });

  it('derives the project from a note change, ignoring paths outside the vault projects', async () => {
    const cases = [
      {
        name: 'a task note change',
        fire: (v: FakeVault) =>
          v.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md'),
        expected: ['Acme Widgets'],
      },
      {
        name: 'a home-note change with a drifted filename',
        fire: (v: FakeVault) => v.fireNoteChanged('Projecten/New Name/Old Name.md'),
        expected: ['New Name'],
      },
      {
        name: 'a path outside Projecten',
        fire: (v: FakeVault) => v.fireNoteChanged('Notes/random.md'),
        expected: [],
      },
    ];
    for (const c of cases) {
      const vault = new FakeVault();
      const queue = new FakeQueue();
      schedulerWith(vault, queue).load();

      c.fire(vault);
      await vi.advanceTimersByTimeAsync(1);

      expect(queue.enqueued, c.name).toEqual(c.expected);
    }
  });

  it('debounces rapid changes, deletions and their mix into one enqueue per project', async () => {
    const cases = [
      (v: FakeVault) => {
        v.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
        v.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
        v.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
      },
      (v: FakeVault) => {
        v.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
        v.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
      },
      (v: FakeVault) => {
        v.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
        v.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
      },
    ];
    for (const fire of cases) {
      const vault = new FakeVault();
      const queue = new FakeQueue();
      schedulerWith(vault, queue, 2000).load();

      fire(vault);
      await vi.advanceTimersByTimeAsync(2000);

      expect(queue.enqueued).toEqual(['Acme Widgets']);
    }
  });

  it('ignores deletions and renames outside Projecten', async () => {
    for (const fire of [
      (v: FakeVault) => v.fireNoteDeleted('Notes/random.md'),
      (v: FakeVault) => v.fireNoteRenamed('Notes/a.md', 'Notes/b.md'),
    ]) {
      const vault = new FakeVault();
      const queue = new FakeQueue();
      schedulerWith(vault, queue).load();

      fire(vault);
      await vi.advanceTimersByTimeAsync(1);

      expect(queue.enqueued).toEqual([]);
    }
  });

  it('fires a rename immediately, bypassing the debounce', async () => {
    const vault = new FakeVault();
    const queue = new FakeQueue();
    schedulerWith(vault, queue, 2000).load();

    vault.fireNoteRenamed(
      'Projecten/Acme Widgets/todos/fi.md',
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(queue.enqueued).toEqual(['Acme Widgets']);
  });

  it('runs the capture hook before enumerating, and survives its failure', async () => {
    const captured = new FakeVault();
    captured.projectNotes = [projectNote('Acme Widgets', null)];
    const capturedQueue = new FakeQueue();
    schedulerWith(captured, capturedQueue, 0, async () => ['New Project']).load();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(capturedQueue.enqueued).toEqual(['Acme Widgets', 'New Project']);

    const failed = new FakeVault();
    failed.projectNotes = [projectNote('Acme Widgets', null)];
    const failedQueue = new FakeQueue();
    schedulerWith(failed, failedQueue, 0, async () => {
      throw new Error('capture failed');
    }).load();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(failedQueue.enqueued).toEqual(['Acme Widgets']);
  });
});
