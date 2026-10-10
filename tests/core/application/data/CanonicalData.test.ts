import { describe, expect, it } from 'vitest';
import { TaskData } from '../../../../src/core/application/data/TaskData.js';

// The canonical string is the snapshot the diff compares against (the base).
// Its one job is to move when, and only when, a diffed field moves; field-by-
// field attribution lives in the diff suite. These tests pin the two things the
// diff cannot express by example: determinism, and that the field delimiter
// keeps boundaries distinct.
function task(overrides: Partial<TaskData> = {}): TaskData {
  const base = new TaskData({
    id: 'task-1',
    notePath: 'Projecten/Acme Widgets/taken/fix-the-bug.md',
    mirrors: { github: 'https://github.com/acme/widgets/issues/42' },
    title: 'Fix the bug',
    body: 'The bug happens on resize.',
    status: 'Building',
    completedAt: null,
    type: 'task',
    parent: null,
    createdAt: '2026-09-18T10:00:00Z',
    updatedAt: '2026-09-18T10:00:00Z',
  });
  return Object.assign(base, overrides);
}

describe('SYNC-6 — the canonical snapshot is deterministic for equal content', () => {
  it('renders the same string for the same values', () => {
    expect(task().canonical()).toBe(task().canonical());
  });
});

describe('SYNC-6 — the canonical delimiter keeps field boundaries distinct', () => {
  it('distinguishes the same characters split across a field boundary', () => {
    const split = task({ title: 'ab', body: 'c' });
    const other = task({ title: 'a', body: 'bc' });
    expect(split.canonical()).not.toBe(other.canonical());
  });

  it('documents the NUL-free constraint: a NUL in a field can shift a boundary', () => {
    // canonical() delimits fields with \u0000, so a value carrying NUL lets its
    // content bleed across a delimiter. The mappers normalize content at the
    // boundary; this pins the invariant the diff relies on.
    const spoof = task({ title: 'a\u0000b', body: 'c' });
    const honest = task({ title: 'a', body: 'b\u0000c' });
    expect(spoof.canonical()).toBe(honest.canonical());
  });
});
