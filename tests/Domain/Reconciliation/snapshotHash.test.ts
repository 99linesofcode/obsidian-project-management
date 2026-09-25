import { describe, expect, it } from 'vitest';
import { snapshotHash } from '../../../src/Domain/Reconciliation/snapshotHash.js';

const shape = {
  content: 'Fix the bug',
  labels: ['task'],
  sectionId: 'S1',
  parentId: null,
  isCompleted: false,
};

describe('snapshotHash', () => {
  it('is deterministic for the same shape', () => {
    // Given — one snapshot shape

    // When — it is hashed twice
    const first = snapshotHash(shape);
    const second = snapshotHash(shape);

    // Then — both hashes are identical
    expect(second).toBe(first);
  });

  it('ignores label order', () => {
    // Given — the same labels in a different order

    // When — both shapes are hashed
    const first = snapshotHash({ ...shape, labels: ['task', 'slice'] });
    const second = snapshotHash({ ...shape, labels: ['slice', 'task'] });

    // Then — the hashes agree
    expect(second).toBe(first);
  });

  it('changes when a content field changes', () => {
    // Given — a shape whose completion moved

    // When — both shapes are hashed
    const first = snapshotHash(shape);
    const second = snapshotHash({ ...shape, isCompleted: true });

    // Then — the hashes differ
    expect(second).not.toBe(first);
  });

  it('treats a null section as empty', () => {
    // Given — a subtask whose section is not controlled

    // When — both shapes are hashed
    const first = snapshotHash({ ...shape, sectionId: null });
    const second = snapshotHash({ ...shape, sectionId: '' });

    // Then — the hashes agree
    expect(second).toBe(first);
  });
});
