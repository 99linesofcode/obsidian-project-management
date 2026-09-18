import { describe, expect, it } from 'vitest';
import { SyncVerdict } from '../../../src/Domain/Reconciliation/SyncVerdict.js';

describe('SyncVerdict', () => {
  it('holds a per-dimension verdict for the body and status', () => {
    // Given — a body and status verdict

    // When — a sync verdict is constructed
    const verdict = new SyncVerdict({ body: 'push', status: 'pull' });

    // Then — it exposes both dimensions
    expect(verdict.body).toBe('push');
    expect(verdict.status).toBe('pull');
  });
});
