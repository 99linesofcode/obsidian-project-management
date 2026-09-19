import { describe, expect, it } from 'vitest';
import { ObservedState } from '../../../src/Domain/Reconciliation/ObservedState.js';
import type {
  BaselineView,
  NoteView,
  RemoteView,
} from '../../../src/Domain/Reconciliation/ObservedState.js';

describe('ObservedState', () => {
  it('holds the three views of one task', () => {
    // Given — a note, remote and baseline view of the same task
    const note: NoteView = {
      body: 'The bug happens on resize.',
      status: 'open',
    };
    const remote: RemoteView = {
      body: 'The bug happens on resize.',
      status: 'open',
      updatedAt: '2026-09-18T10:00:00Z',
    };
    const baseline: BaselineView = {
      lastSyncedBodyHash: 'abc123',
      lastSyncedRemoteUpdatedAt: '2026-09-18T10:00:00Z',
      lastSyncedStatus: 'open',
    };

    // When — an observed state is constructed
    const observed = new ObservedState(note, remote, baseline);

    // Then — it exposes the three views unchanged
    expect(observed.note).toBe(note);
    expect(observed.remote).toBe(remote);
    expect(observed.baseline).toBe(baseline);
  });
});
