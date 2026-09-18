import { describe, expect, it } from 'vitest';
import { ObservedState } from '../../../src/Domain/Reconciliation/ObservedState.js';
import { VerdictResolver } from '../../../src/Domain/Reconciliation/VerdictResolver.js';
import { hash } from '../../../src/Domain/Notes/hash.js';
import type { BaselineView, NoteView, RemoteView } from '../../../src/Domain/Reconciliation/ObservedState.js';

const BODY = 'The bug happens when the widget is resized.';
const UPDATED_AT = '2026-09-18T10:00:00Z';
const LATER = '2026-09-18T11:00:00Z';

// Builds an ObservedState where, by default, note, remote and baseline all
// agree. Overrides flip one view at a time to set up a scenario.
function makeObserved(overrides: {
  note?: Partial<NoteView>;
  remote?: Partial<RemoteView>;
  baseline?: Partial<BaselineView>;
} = {}): ObservedState {
  const note = { body: BODY, status: 'open', ...overrides.note } as NoteView;
  const remote = { body: BODY, status: 'open', updatedAt: UPDATED_AT, ...overrides.remote } as RemoteView;
  const baseline = {
    lastSyncedBodyHash: hash(BODY),
    lastSyncedRemoteUpdatedAt: UPDATED_AT,
    lastSyncedStatus: 'open',
    ...overrides.baseline,
  } as BaselineView;
  return new ObservedState(note, remote, baseline);
}

const resolver = new VerdictResolver();

describe('VerdictResolver', () => {
  describe('body dimension', () => {
    it('pushes the note body when only the note changed', () => {
      // Given — the note body changed since the last sync, the remote did not
      const observed = makeObserved({ note: { body: 'The bug now also happens on resize.' } });

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the body is pushed
      expect(verdict.body).toBe('push');
    });

    it('pulls the remote body when only the remote changed', () => {
      // Given — the remote body changed since the last sync, the note did not
      const observed = makeObserved({ remote: { updatedAt: LATER } });

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the body is pulled
      expect(verdict.body).toBe('pull');
    });

    it('conflicts (note wins) when both the note and remote changed', () => {
      // Given — both the note body and the remote changed since the last sync
      const observed = makeObserved({
        note: { body: 'The bug now also happens on resize.' },
        remote: { updatedAt: LATER },
      });

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the body conflicts and the note wins
      expect(verdict.body).toBe('conflict');
    });

    it('does nothing when neither the note nor the remote changed', () => {
      // Given — note, remote and baseline all agree
      const observed = makeObserved();

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the body is left alone
      expect(verdict.body).toBe('none');
    });
  });

  describe('status dimension', () => {
    it('pushes the note status when only the note changed', () => {
      // Given — the note status changed since the last sync, the remote did not
      const observed = makeObserved({ note: { status: 'done' } });

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the status is pushed
      expect(verdict.status).toBe('push');
    });

    it('pulls the remote status when only the remote changed', () => {
      // Given — the remote status changed since the last sync, the note did not
      const observed = makeObserved({ remote: { status: 'done' } });

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the status is pulled
      expect(verdict.status).toBe('pull');
    });

    it('conflicts (note wins) when both statuses changed', () => {
      // Given — both the note and remote status changed since the last sync
      const observed = makeObserved({ note: { status: 'done' }, remote: { status: 'done' } });

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the status conflicts and the note wins
      expect(verdict.status).toBe('conflict');
    });

    it('does nothing when neither status changed', () => {
      // Given — note, remote and baseline all agree
      const observed = makeObserved();

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the status is left alone
      expect(verdict.status).toBe('none');
    });
  });

  describe('mixed dimensions', () => {
    it('decides each dimension independently (body push, status pull)', () => {
      // Given — the note body changed and the remote status changed
      const observed = makeObserved({
        note: { body: 'The bug now also happens on resize.' },
        remote: { status: 'done' },
      });

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the body is pushed and the status is pulled
      expect(verdict.body).toBe('push');
      expect(verdict.status).toBe('pull');
    });

    it('decides each dimension independently (body pull, status push)', () => {
      // Given — the remote body changed and the note status changed
      const observed = makeObserved({
        remote: { updatedAt: LATER },
        note: { status: 'done' },
      });

      // When — the verdict is resolved
      const verdict = resolver.resolve(observed);

      // Then — the body is pulled and the status is pushed
      expect(verdict.body).toBe('pull');
      expect(verdict.status).toBe('push');
    });
  });

  describe('purity', () => {
    it('is deterministic for the same input', () => {
      // Given — a scenario where both the note and remote changed
      const observed = makeObserved({
        note: { body: 'The bug now also happens on resize.', status: 'done' },
        remote: { updatedAt: LATER, status: 'done' },
      });

      // When — the verdict is resolved twice
      const first = resolver.resolve(observed);
      const second = resolver.resolve(observed);

      // Then — both verdicts are identical
      expect(second).toEqual(first);
    });

    it('does not mutate the observed state it is given', () => {
      // Given — an observed state
      const observed = makeObserved({ note: { body: 'The bug now also happens on resize.' } });
      const before = {
        note: { ...observed.note },
        remote: { ...observed.remote },
        baseline: { ...observed.baseline },
      };

      // When — the verdict is resolved
      resolver.resolve(observed);

      // Then — the observed state is unchanged (no side effects)
      expect(observed.note).toEqual(before.note);
      expect(observed.remote).toEqual(before.remote);
      expect(observed.baseline).toEqual(before.baseline);
    });
  });
});
