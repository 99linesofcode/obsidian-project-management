import { describe, expect, it } from 'vitest';
import { taskData } from './taskView.js';

// snapshotHash() now lives on the canonical base class: one canonical
// serialization per DTO, hashed once. These tests pin the determinism the diff
// and the base store rely on.
describe('DataTransferObject.snapshotHash', () => {
  it('is deterministic for the same canonical values', () => {
    // Given — two tasks with equal content

    // When — both are hashed

    // Then — the hashes agree
    expect(taskData().snapshotHash()).toBe(taskData().snapshotHash());
  });

  it('changes when a diffed field changes', () => {
    // Given — a task whose content moved

    // When — both are hashed

    // Then — the hashes differ
    expect(taskData({ title: 'Other' }).snapshotHash()).not.toBe(
      taskData().snapshotHash(),
    );
  });

  it('ignores identity and provenance', () => {
    // Given — a task whose id and timestamps moved

    // When — both are hashed

    // Then — the hashes agree
    const moved = taskData({
      id: 'task-2',
      updatedAt: '2020-01-01T00:00:00Z',
    });
    expect(moved.snapshotHash()).toBe(taskData().snapshotHash());
  });
});
