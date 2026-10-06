import { describe, expect, it } from 'vitest';
import { hash } from '../../src/shared/hash.js';
import {
  toDiffView,
  toDiffViewWithBody,
} from '../../src/shared/toDiffView.js';
import { taskData } from '../helpers/records.js';

describe('SYNC-6 — the diff view is the comparable shape', () => {
  it('replaces the body with the digest of the comparable body', () => {


    const live = taskData({ body: 'The bug happens on resize.' });
    expect(toDiffView(live, 'normalized body').body).toBe(
      hash('normalized body'),
    );
  });

  it('preserves every other field', () => {


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


    const live = taskData({ body: 'real body' });
    toDiffView(live, 'normalized');
    expect(live.body).toBe('real body');
  });

  it('digests the body as-is when there is no rendering step', () => {


    const live = taskData({ body: 'real body' });
    expect(toDiffViewWithBody(live).body).toBe(hash('real body'));
  });
});
