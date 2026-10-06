import { describe, expect, it } from 'vitest';
import { Mirror } from '../../../src/Domain/DataTransferObjects/Mirror.js';
import { ProjectData } from '../../../src/Domain/DataTransferObjects/ProjectData.js';
import { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import { ToDoData } from '../../../src/Domain/DataTransferObjects/ToDoData.js';

// The canonical DTOs are classes now: the constructor is positional, so a
// builder names the defaults once and each scenario overrides only what it
// cares about.
function task(overrides: Partial<TaskData> = {}): TaskData {
  const base = new TaskData(
    'task-1',
    'Projecten/Acme Widgets/taken/fix-the-bug.md',
    { github: 'https://github.com/acme/widgets/issues/42' },
    'Fix the bug',
    'The bug happens on resize.',
    'Building',
    null,
    'task',
    null,
    '2026-09-18T10:00:00Z',
    '2026-09-18T10:00:00Z',
  );
  return Object.assign(base, overrides);
}

function todo(overrides: Partial<ToDoData> = {}): ToDoData {
  const base = new ToDoData(
    'todo-1',
    'Projecten/Acme Widgets/todos/fix-the-bug.md',
    { todoist: 'T1' },
    'Fix the bug',
    'open',
    null,
    null,
    'task-1',
    '2026-09-18T10:00:00Z',
    '2026-09-18T10:00:00Z',
  );
  return Object.assign(base, overrides);
}

function project(overrides: Partial<ProjectData> = {}): ProjectData {
  const base = new ProjectData(
    'project-1',
    'Projecten/Acme Widgets',
    { github: 'https://github.com/acme/widgets' },
    'Acme Widgets',
    null,
    ['Unshaped', 'Building', 'Done'],
    'Done',
    '2026-09-18T10:00:00Z',
    '2026-09-18T10:00:00Z',
  );
  return Object.assign(base, overrides);
}

describe('TaskData.canonical', () => {
  it('renders the same string for the same diffed values', () => {
    // Given — two tasks with equal content

    // When — both are canonicalized

    // Then — the strings agree
    expect(task().canonical()).toBe(task().canonical());
  });

  it('changes when a diffed field changes', () => {
    // Given — a task whose title moved

    // When — both are canonicalized

    // Then — the strings differ
    expect(task({ title: 'Fix the other bug' }).canonical()).not.toBe(
      task().canonical(),
    );
  });

  it('excludes identity and provenance', () => {
    // Given — a task whose id, path, mirrors and timestamps all moved

    // When — both are canonicalized

    // Then — the content string is unchanged
    const moved = task({
      id: 'task-2',
      notePath: 'Projecten/Elsewhere/taken/renamed.md',
      mirrors: {},
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    });
    expect(moved.canonical()).toBe(task().canonical());
  });

  it('keeps field boundaries distinct for NUL-free values', () => {
    // Given — the same characters split across a field boundary

    // When — both are canonicalized

    // Then — the strings differ (the delimiter preserves the split)
    const split = task({ title: 'ab', body: 'c' });
    const other = task({ title: 'a', body: 'bc' });
    expect(split.canonical()).not.toBe(other.canonical());
  });

  it('documents the NUL-free constraint: a NUL in a field can shift a boundary', () => {
    // canonical() delimits fields with \u0000, so a value carrying NUL lets
    // its content bleed across a delimiter. The mappers normalize content at
    // the boundary; this pins the invariant the diff relies on.
    const spoof = task({ title: 'a\u0000b', body: 'c' });
    const honest = task({ title: 'a', body: 'b\u0000c' });
    expect(spoof.canonical()).toBe(honest.canonical());
  });
});

describe('ToDoData.canonical', () => {
  it('renders the same string for the same values', () => {
    expect(todo().canonical()).toBe(todo().canonical());
  });

  it('changes when status, completion, parent or owning task changes', () => {
    // Given — a to-do that completed, with a parent and owning task

    // When — both are canonicalized

    // Then — each content field moves the string
    const done = todo({
      status: 'completed',
      completedAt: '2026-09-18T12:00:00Z',
      parentTodo: 'todo-0',
      task: 'task-9',
    });
    expect(done.canonical()).not.toBe(todo().canonical());
  });

  it('excludes identity and provenance', () => {
    const moved = todo({
      id: 'todo-2',
      notePath: 'Projecten/Elsewhere/todos/renamed.md',
      mirrors: {},
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    });
    expect(moved.canonical()).toBe(todo().canonical());
  });
});

describe('ProjectData.canonical', () => {
  it('renders the same string for the same values', () => {
    expect(project().canonical()).toBe(project().canonical());
  });

  it('changes when name, archive stamp, lanes or done lane changes', () => {
    // Given — a project whose lane vocabulary and done lane moved

    // When — both are canonicalized

    // Then — the strings differ
    const moved = project({
      name: 'Acme Widgets v2',
      archivedAt: '2026-09-18T12:00:00Z',
      statusOptions: ['Backlog', 'Done'],
      doneLane: 'Shipped',
    });
    expect(moved.canonical()).not.toBe(project().canonical());
  });

  it('excludes identity and provenance', () => {
    const moved = project({
      id: 'project-2',
      path: 'Projecten/Elsewhere',
      mirrors: {},
      createdAt: '2020-01-01T00:00:00Z',
      updatedAt: '2020-01-01T00:00:00Z',
    });
    expect(moved.canonical()).toBe(project().canonical());
  });

  it('keeps lane boundaries distinct when a lane name contains a comma', () => {
    // Given — the same characters split across a lane boundary. A ',' delimiter
    // would collapse these onto one canonical string; the NUL delimiter keeps
    // the split, matching the field-boundary contract.
    const oneLane = project({ statusOptions: ['a,b'] });
    const twoLanes = project({ statusOptions: ['a', 'b'] });

    // When/Then — the canonical strings differ
    expect(oneLane.canonical()).not.toBe(twoLanes.canonical());
  });
});

describe('DataTransferObject.snapshotHash', () => {
  it('is deterministic for the same canonical values', () => {
    // Given — two tasks with equal content

    // When — both are hashed

    // Then — the hashes agree
    expect(task().snapshotHash()).toBe(task().snapshotHash());
  });

  it('changes when a diffed field changes', () => {
    expect(task({ body: 'Other body.' }).snapshotHash()).not.toBe(
      task().snapshotHash(),
    );
  });

  it('ignores identity and provenance', () => {
    const moved = task({
      id: 'task-2',
      notePath: 'Projecten/Elsewhere/taken/renamed.md',
      updatedAt: '2020-01-01T00:00:00Z',
    });
    expect(moved.snapshotHash()).toBe(task().snapshotHash());
  });
});

describe('Mirror', () => {
  it('round-trips a handle and a base through a mirrors map', () => {
    // Given — one mirror entry with a synced base

    // When — it is stored under its provider name

    // Then — the entry reads back unchanged
    const mirror = new Mirror(
      'https://github.com/acme/widgets/issues/42',
      task(),
    );
    const mirrors: Record<string, Mirror> = { github: mirror };
    expect(mirrors.github).toBe(mirror);
    expect(mirrors.github?.handle).toBe(
      'https://github.com/acme/widgets/issues/42',
    );
    expect(mirrors.github?.base).toBe(mirror.base);
  });

  it('allows a null base before the first sync', () => {
    // Given — a mirror that has never synced

    // When — it is constructed without a base

    // Then — the base is null
    expect(new Mirror('T1', null).base).toBeNull();
  });
});
