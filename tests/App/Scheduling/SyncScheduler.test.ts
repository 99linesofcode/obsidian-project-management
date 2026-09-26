import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The scheduler extends Obsidian's Component; mock it so the test runs
// without the host app. load() triggers onload(), which registers the timer.
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

import { SyncScheduler } from '../../../src/App/Scheduling/SyncScheduler.js';
import type { SyncQueue } from '../../../src/App/Scheduling/SyncQueue.js';
import type { ProjectNoteData } from '../../../src/Domain/DataTransferObjects/ProjectNoteData.js';
import type { VaultPort } from '../../../src/Domain/Ports/VaultPort.js';

// A fake vault that exposes the three subscription callbacks and a canned
// discovery result, so the scheduler's trigger wiring is observable.
class FakeVault implements VaultPort {
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

// A fake queue that records every enqueue, so the scheduler's trigger policies
// are observable without the real chain.
class FakeQueue {
  enqueued: string[] = [];
  enqueue(project: string): void {
    this.enqueued.push(project);
  }
}

function projectNote(projectName: string, archived: boolean): ProjectNoteData {
  return {
    path: `${archived ? 'Archief' : 'Projecten'}/${projectName}/_home.md`,
    projectName,
    archived,
    pm: 'github',
    url: 'https://github.com/acme/widgets',
    board: 'https://github.com/orgs/acme/projects/1',
  };
}

function schedulerWith(
  vault: FakeVault,
  queue: FakeQueue,
  debounceMs = 0,
): SyncScheduler {
  return new SyncScheduler(
    vault,
    queue as unknown as SyncQueue,
    60_000,
    debounceMs,
  );
}

describe('SyncScheduler', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Obsidian runs in a browser where window is the global; the scheduler
    // uses window.setInterval/setTimeout, so point window at the faked globals.
    vi.stubGlobal('window', globalThis);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('enqueues every discovered project on each tick', async () => {
    // Given — a scheduler wired to two projects on a 60s interval
    const vault = new FakeVault();
    vault.projectNotes = [
      projectNote('Acme Widgets', false),
      projectNote('Other', false),
    ];
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue);
    scheduler.load();

    // When — one interval elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — every discovered project is enqueued
    expect(queue.enqueued).toEqual(['Acme Widgets', 'Other']);
  });

  it('enqueues archived projects too, so the chain can watch them', async () => {
    // Given — an archived project note
    const vault = new FakeVault();
    vault.projectNotes = [projectNote('Acme Widgets', true)];
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue);
    scheduler.load();

    // When — one interval elapses
    await vi.advanceTimersByTimeAsync(60_000);

    // Then — the archived project is enqueued
    expect(queue.enqueued).toEqual(['Acme Widgets']);
  });

  it('derives the project name from a note change and enqueues it', async () => {
    // Given — a scheduler subscribed to vault note changes
    const vault = new FakeVault();
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue);
    scheduler.load();

    // When — a task note under Projecten changes
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — the derived project is enqueued
    expect(queue.enqueued).toEqual(['Acme Widgets']);
  });

  it('derives the project name from a home-note change, not its filename', async () => {
    // Given — a scheduler subscribed to vault note changes
    const vault = new FakeVault();
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue);
    scheduler.load();

    // When — a legacy-named home note under a renamed folder changes
    vault.fireNoteChanged('Projecten/New Name/Old Name.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — the folder decides the project name; the filename is meaningless
    expect(queue.enqueued).toEqual(['New Name']);
  });

  it('ignores note changes outside Projecten', async () => {
    // Given — a scheduler subscribed to vault note changes
    const vault = new FakeVault();
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue);
    scheduler.load();

    // When — a note outside Projecten changes
    vault.fireNoteChanged('Notes/random.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — nothing is enqueued
    expect(queue.enqueued).toEqual([]);
  });

  it('debounces rapid note changes into one enqueue', async () => {
    // Given — a scheduler with a 2s debounce
    const vault = new FakeVault();
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue, 2000);
    scheduler.load();

    // When — several changes for the same project arrive within the window
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(2000);

    // Then — they coalesce into a single enqueue
    expect(queue.enqueued).toEqual(['Acme Widgets']);
  });

  it('debounces note deletions per project', async () => {
    // Given — a scheduler with a 2s debounce
    const vault = new FakeVault();
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue, 2000);
    scheduler.load();

    // When — a task note under Projecten is deleted twice within the window
    vault.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    vault.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(2000);

    // Then — the project is enqueued once
    expect(queue.enqueued).toEqual(['Acme Widgets']);
  });

  it('coalesces a change and a delete for the same project', async () => {
    // Given — a scheduler with a 2s debounce
    const vault = new FakeVault();
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue, 2000);
    scheduler.load();

    // When — a change and a delete for the same project arrive in the window
    vault.fireNoteChanged('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    vault.fireNoteDeleted('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
    await vi.advanceTimersByTimeAsync(2000);

    // Then — the kinds collapse: one enqueue, not two
    expect(queue.enqueued).toEqual(['Acme Widgets']);
  });

  it('ignores note deletions outside Projecten', async () => {
    // Given — a scheduler subscribed to vault note deletions
    const vault = new FakeVault();
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue);
    scheduler.load();

    // When — a note outside Projecten is deleted
    vault.fireNoteDeleted('Notes/random.md');
    await vi.advanceTimersByTimeAsync(1);

    // Then — nothing is enqueued
    expect(queue.enqueued).toEqual([]);
  });

  it('fires a rename immediately, bypassing the debounce', async () => {
    // Given — a scheduler with a 2s debounce
    const vault = new FakeVault();
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue, 2000);
    scheduler.load();

    // When — a to-do is renamed
    vault.fireNoteRenamed(
      'Projecten/Acme Widgets/todos/fi.md',
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    );
    await vi.advanceTimersByTimeAsync(0);

    // Then — it is enqueued without waiting out the debounce window
    expect(queue.enqueued).toEqual(['Acme Widgets']);
  });

  it('ignores renames outside Projecten', async () => {
    // Given — a scheduler subscribed to vault renames
    const vault = new FakeVault();
    const queue = new FakeQueue();
    const scheduler = schedulerWith(vault, queue);
    scheduler.load();

    // When — a note outside Projecten is renamed
    vault.fireNoteRenamed('Notes/a.md', 'Notes/b.md');
    await vi.advanceTimersByTimeAsync(0);

    // Then — nothing is enqueued
    expect(queue.enqueued).toEqual([]);
  });
});
