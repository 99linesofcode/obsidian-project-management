import { describe, expect, it } from 'vitest';
import { VerdictResolver } from '../../src/shared/VerdictResolver.js';
import { taskData } from '../helpers/records.js';

const resolver = new VerdictResolver('Done');

describe('SYNC-3 — the decision ladder resolves every field', () => {
  it('pushes a field the vault changed and the remote did not', () => {
    const base = taskData();
    const vault = taskData({ title: 'Vault title' });
    const verdicts = resolver.diff(vault, base, base);
    expect(verdicts.title).toBe('push');
    expect(verdicts.body).toBe('none');
    expect(verdicts.status).toBe('none');
  });

  it('pulls a field the remote changed and the vault did not', () => {
    const base = taskData();
    const remote = taskData({ status: 'Done' });
    expect(resolver.diff(base, remote, base).status).toBe('pull');
  });

  it('conflicts a field both sides changed', () => {
    const base = taskData();
    const vault = taskData({ body: 'vault-digest' });
    const remote = taskData({ body: 'remote-digest' });
    expect(resolver.diff(vault, remote, base).body).toBe('conflict');
  });

  it('leaves a field alone when neither side changed', () => {
    const base = taskData();
    const verdicts = resolver.diff(base, base, base);
    expect(verdicts).toEqual({
      title: 'none',
      body: 'none',
      status: 'none',
      completedAt: 'none',
      type: 'none',
      parent: 'none',
    });
  });

  it('attributes each content field independently', () => {
    const base = taskData();
    const vault = taskData({ body: 'vault-digest' });
    const remote = taskData({ status: 'Done' });
    const verdicts = resolver.diff(vault, remote, base);
    expect(verdicts.body).toBe('push');
    expect(verdicts.status).toBe('pull');
    expect(verdicts.title).toBe('none');
  });

  it('attributes type and parent', () => {
    const base = taskData();
    const vault = taskData({ type: 'slice' });
    const remote = taskData({ parent: 'task-9' });
    const verdicts = resolver.diff(vault, remote, base);
    expect(verdicts.type).toBe('push');
    expect(verdicts.parent).toBe('pull');
  });

  it('attributes completedAt', () => {
    const base = taskData();
    const remote = taskData({ completedAt: '2026-09-18T12:00:00Z' });
    expect(resolver.diff(base, remote, base).completedAt).toBe('pull');
  });

  it('is deterministic for the same input', () => {
    const base = taskData();
    const vault = taskData({ body: 'vault-digest' });
    const remote = taskData({ status: 'Done' });
    expect(resolver.diff(vault, remote, base)).toEqual(
      resolver.diff(vault, remote, base),
    );
  });
});
