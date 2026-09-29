import { describe, expect, it } from 'vitest';
import { SyncVerdict } from '../../../src/Domain/Reconciliation/SyncVerdict.js';

describe('SyncVerdict', () => {
  it('holds one verdict per content field', () => {
    // Given — a verdict for each diffed field

    // When — a sync verdict is constructed

    // Then — it exposes every field
    const verdict = new SyncVerdict({
      title: 'push',
      body: 'pull',
      status: 'conflict',
      completedAt: 'none',
      type: 'push',
      parent: 'pull',
    });
    expect(verdict.title).toBe('push');
    expect(verdict.body).toBe('pull');
    expect(verdict.status).toBe('conflict');
    expect(verdict.completedAt).toBe('none');
    expect(verdict.type).toBe('push');
    expect(verdict.parent).toBe('pull');
  });
});
