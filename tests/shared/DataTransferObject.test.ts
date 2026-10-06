import { describe, expect, it } from 'vitest';
import { taskData } from '../helpers/records.js';

// snapshotHash() now lives on the canonical base class: one canonical
// serialization per DTO, hashed once. These tests pin the determinism the diff
// and the base store rely on.
describe('SYNC-6 — the base advances only when a mirror is written', () => {
  it('is deterministic for the same canonical values', () => {


    expect(taskData().snapshotHash()).toBe(taskData().snapshotHash());
  });

  it('changes when a diffed field changes', () => {


    expect(taskData({ title: 'Other' }).snapshotHash()).not.toBe(
      taskData().snapshotHash(),
    );
  });

  it('ignores identity and provenance', () => {


    const moved = taskData({
      id: 'task-2',
      updatedAt: '2020-01-01T00:00:00Z',
    });
    expect(moved.snapshotHash()).toBe(taskData().snapshotHash());
  });
});
