import { describe, expect, it, vi } from 'vitest';

// The adapter imports TFile from Obsidian, which has no runtime entry in the
// package (types only). Mock just that class so the adapter's event wiring can
// be exercised without the host app — the same hand-rolled vi.mock('obsidian')
// machinery the scheduler test already uses.
const { TFile } = vi.hoisted(() => {
  class TFile {
    constructor(
      public path: string,
      public extension: string,
    ) {}
  }
  return { TFile };
});

vi.mock('obsidian', () => ({ TFile }));

import type { App, EventRef } from 'obsidian';
import { VaultAdapter } from '../../../src/Infrastructure/Obsidian/VaultAdapter.js';

// A fake vault that records the handlers the adapter subscribes and lets a
// test fire an event at them, so the adapter's filter and routing are what's
// under test.
class FakeVault {
  private readonly handlers = new Map<
    string,
    Array<(...args: unknown[]) => void>
  >();

  on(event: string, handler: (...args: unknown[]) => void): EventRef {
    const handlers = this.handlers.get(event) ?? [];
    handlers.push(handler);
    this.handlers.set(event, handlers);
    return {} as EventRef;
  }

  fire(event: string, ...args: unknown[]): void {
    for (const handler of this.handlers.get(event) ?? []) {
      handler(...args);
    }
  }
}

function setup() {
  const vault = new FakeVault();
  const app = { vault } as unknown as App;
  const registered: EventRef[] = [];
  const adapter = new VaultAdapter(app, (ref) => registered.push(ref));
  const changed: string[] = [];
  const renamed: Array<{ oldPath: string; newPath: string }> = [];
  adapter.onNoteChanged((path) => changed.push(path));
  adapter.onNoteRenamed((oldPath, newPath) =>
    renamed.push({ oldPath, newPath }),
  );
  return { vault, registered, changed, renamed };
}

describe('VaultAdapter.onNoteChanged', () => {
  it('routes a created task note under Projecten through the change callback', () => {
    // Given — an adapter subscribed to note changes
    const { vault, changed } = setup();

    // When — a task note is created under Projecten
    vault.fire(
      'create',
      new TFile('Projecten/Acme Widgets/taken/42-fix-the-bug.md', 'md'),
    );

    // Then — the change callback receives the created note's path
    expect(changed).toEqual(['Projecten/Acme Widgets/taken/42-fix-the-bug.md']);
  });

  it('routes a modified task note under Projecten through the change callback', () => {
    // Given — an adapter subscribed to note changes
    const { vault, changed } = setup();

    // When — a task note is modified under Projecten
    vault.fire(
      'modify',
      new TFile('Projecten/Acme Widgets/taken/42-fix-the-bug.md', 'md'),
    );

    // Then — the change callback receives the modified note's path
    expect(changed).toEqual(['Projecten/Acme Widgets/taken/42-fix-the-bug.md']);
  });

  it('ignores created notes outside Projecten', () => {
    // Given — an adapter subscribed to note changes
    const { vault, changed } = setup();

    // When — a note outside Projecten is created
    vault.fire('create', new TFile('Notes/random.md', 'md'));

    // Then — the change callback is not invoked
    expect(changed).toEqual([]);
  });

  it('ignores created non-markdown files under Projecten', () => {
    // Given — an adapter subscribed to note changes
    const { vault, changed } = setup();

    // When — a non-markdown file is created under Projecten
    vault.fire(
      'create',
      new TFile('Projecten/Acme Widgets/board.canvas', 'canvas'),
    );

    // Then — the change callback is not invoked
    expect(changed).toEqual([]);
  });

  it('registers every subscription for cleanup on unload', () => {
    // Given — an adapter subscribed to note changes and renames
    const { registered } = setup();

    // When — the subscriptions are registered
    // Then — the modify, create and rename subscriptions are handed to the
    // plugin's registerEvent for cleanup
    expect(registered).toHaveLength(3);
  });
});

describe('VaultAdapter.onNoteRenamed', () => {
  it('routes a renamed task note under Projecten through the rename callback', () => {
    // Given — an adapter subscribed to note renames
    const { vault, renamed } = setup();

    // When — a task note under Projecten is renamed
    vault.fire(
      'rename',
      new TFile('Projecten/Acme Widgets/taken/42-fix-the-bug.md', 'md'),
      'Projecten/Acme Widgets/taken/42-old.md',
    );

    // Then — the callback receives both the old and the new path
    expect(renamed).toEqual([
      {
        oldPath: 'Projecten/Acme Widgets/taken/42-old.md',
        newPath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      },
    ]);
  });

  it('ignores renames outside Projecten', () => {
    // Given — an adapter subscribed to note renames
    const { vault, renamed } = setup();

    // When — a note outside Projecten is renamed
    vault.fire('rename', new TFile('Notes/random.md', 'md'), 'Notes/old.md');

    // Then — the callback is not invoked
    expect(renamed).toEqual([]);
  });

  it('ignores renamed non-markdown files under Projecten', () => {
    // Given — an adapter subscribed to note renames
    const { vault, renamed } = setup();

    // When — a non-markdown file is renamed under Projecten
    vault.fire(
      'rename',
      new TFile('Projecten/Acme Widgets/board.canvas', 'canvas'),
      'Projecten/Acme Widgets/old.canvas',
    );

    // Then — the callback is not invoked
    expect(renamed).toEqual([]);
  });
});
