import { describe, expect, it } from 'vitest';
import { VaultTaskMapper } from '../../src/vault/VaultTaskMapper.js';
import { TaskNoteMapper } from '../../src/vault/TaskNoteMapper.js';

const context = { projectName: 'Acme Widgets', doneLane: 'Shipped' };
const notePath = 'Projecten/Acme Widgets/taken/fix-the-bug.md';

describe('VaultTaskMapper', () => {
  it('parses a task note onto the canonical task', () => {
    // Given — a task note produced by the note mapper
    const { content } = TaskNoteMapper.map(
      {
        type: 'task',
        title: 'Fix the bug',
        body: 'The bug happens on resize.',
        createdAt: null,
      },
      {
        projectName: 'Acme Widgets',
        syncedAt: '2026-09-18T12:00:00Z',
        statusName: 'Building',
      },
    );

    // When — the note is parsed
    const task = VaultTaskMapper.parseTask(content, notePath, context);

    // Then — the content is carried; identity waits for the registry record
    expect(task?.id).toBe('');
    expect(task?.type).toBe('task');
    expect(task?.notePath).toBe(notePath);
    expect(task?.mirrors).toEqual({});
    expect(task?.title).toBe('fix the bug');
    expect(task?.body).toBe('The bug happens on resize.');
    expect(task?.status).toBe('Building');
    expect(task?.completedAt).toBeNull();
    // The mapper is pure: the affiliation-derived parent waits for the action
    // layer, which alone can reach the registry.
    expect(task?.parent).toBeNull();
    expect(task?.createdAt).toBe('2026-09-18');
    expect(task?.updatedAt).toBeNull();
  });

  it('reads the done lane as completed (the stamp may be unknown)', () => {
    // Given — a task note in the done lane
    const { content } = TaskNoteMapper.map(
      {
        type: 'task',
        title: 'Fix the bug',
        body: '',
        createdAt: null,
      },
      {
        projectName: 'Acme Widgets',
        syncedAt: '2026-09-18T12:00:00Z',
        statusName: 'Shipped',
      },
    );

    // When — the note is parsed
    const task = VaultTaskMapper.parseTask(content, notePath, context);

    // Then — the task is completed: '' marks done with an unknown stamp
    expect(task?.completedAt).toBe('');
    expect(task?.status).toBe('Shipped');
  });

  it('returns null for a note that is not a task note', () => {
    // Given — a plain note

    // When — it is parsed
    const task = VaultTaskMapper.parseTask('Just a note.', notePath, context);

    // Then — it is not a task note
    expect(task).toBeNull();
  });
});
