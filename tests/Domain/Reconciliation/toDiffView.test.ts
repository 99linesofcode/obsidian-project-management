import { describe, expect, it } from 'vitest';
import { hash } from '../../../src/Domain/Notes/hash.js';
import {
  toDiffView,
  toDiffViewWithBody,
} from '../../../src/Domain/Reconciliation/toDiffView.js';
import { taskData } from './taskView.js';

describe('toDiffView', () => {
  it('replaces the body with the digest of the comparable body', () => {
    // Given — a live view with a real body

    // When — it is rendered to its diff view

    // Then — the body is the digest
    const live = taskData({ body: 'The bug happens on resize.' });
    expect(toDiffView(live, 'normalized body').body).toBe(
      hash('normalized body'),
    );
  });

  it('preserves every other field', () => {
    // Given — a live view

    // When — it is rendered to its diff view

    // Then — everything but the body is carried over
    const live = taskData();
    const diff = toDiffView(live, 'normalized');
    expect(diff.id).toBe(live.id);
    expect(diff.notePath).toBe(live.notePath);
    expect(diff.mirrors).toEqual(live.mirrors);
    expect(diff.title).toBe(live.title);
    expect(diff.status).toBe(live.status);
    expect(diff.completedAt).toBe(live.completedAt);
    expect(diff.type).toBe(live.type);
    expect(diff.parent).toBe(live.parent);
    expect(diff.createdAt).toBe(live.createdAt);
    expect(diff.updatedAt).toBe(live.updatedAt);
  });

  it('does not mutate the live view', () => {
    // Given — a live view with a real body

    // When — it is rendered to its diff view

    // Then — the live body is untouched
    const live = taskData({ body: 'real body' });
    toDiffView(live, 'normalized');
    expect(live.body).toBe('real body');
  });

  it('digests the body as-is when there is no rendering step', () => {
    // Given — a live view

    // When — its body is digested without a comparable rendering

    // Then — the digest is of the raw body
    const live = taskData({ body: 'real body' });
    expect(toDiffViewWithBody(live).body).toBe(hash('real body'));
  });
});
