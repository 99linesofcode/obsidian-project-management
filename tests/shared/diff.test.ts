import { describe, expect, it } from 'vitest';
import { VerdictResolver } from '../../src/shared/VerdictResolver.js';
import { taskData } from '../helpers/records.js';

const resolver = new VerdictResolver('Done');

describe('VerdictResolver.diff', () => {
  it('pushes a field the vault changed and the remote did not', () => {
    // Given — the vault title moved, the remote still matches base

    // When — the canonical diff runs

    // Then — the title is pushed and nothing else moves
    const base = taskData();
    const vault = taskData({ title: 'Vault title' });
    const verdicts = resolver.diff(vault, base, base);
    expect(verdicts.title).toBe('push');
    expect(verdicts.body).toBe('none');
    expect(verdicts.status).toBe('none');
  });

  it('pulls a field the remote changed and the vault did not', () => {
    // Given — the remote status moved, the vault still matches base

    // When — the canonical diff runs

    // Then — the status is pulled
    const base = taskData();
    const remote = taskData({ status: 'Done' });
    expect(resolver.diff(base, remote, base).status).toBe('pull');
  });

  it('conflicts a field both sides changed', () => {
    // Given — both the vault and the remote body moved

    // When — the canonical diff runs

    // Then — the body conflicts
    const base = taskData();
    const vault = taskData({ body: 'vault-digest' });
    const remote = taskData({ body: 'remote-digest' });
    expect(resolver.diff(vault, remote, base).body).toBe('conflict');
  });

  it('leaves a field alone when neither side changed', () => {
    // Given — vault, remote and base all agree

    // When — the canonical diff runs

    // Then — every field is none
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
    // Given — the vault body moved and the remote status moved

    // When — the canonical diff runs

    // Then — body pushes while status pulls
    const base = taskData();
    const vault = taskData({ body: 'vault-digest' });
    const remote = taskData({ status: 'Done' });
    const verdicts = resolver.diff(vault, remote, base);
    expect(verdicts.body).toBe('push');
    expect(verdicts.status).toBe('pull');
    expect(verdicts.title).toBe('none');
  });

  it('attributes type and parent', () => {
    // Given — the vault type and the remote parent moved

    // When — the canonical diff runs

    // Then — type pushes and parent pulls
    const base = taskData();
    const vault = taskData({ type: 'slice' });
    const remote = taskData({ parent: 'task-9' });
    const verdicts = resolver.diff(vault, remote, base);
    expect(verdicts.type).toBe('push');
    expect(verdicts.parent).toBe('pull');
  });

  it('attributes completedAt', () => {
    // Given — the remote carries a completion stamp base lacks

    // When — the canonical diff runs

    // Then — completedAt pulls
    const base = taskData();
    const remote = taskData({ completedAt: '2026-09-18T12:00:00Z' });
    expect(resolver.diff(base, remote, base).completedAt).toBe('pull');
  });

  it('is deterministic for the same input', () => {
    // Given — a scenario where both sides changed

    // When — the diff runs twice

    // Then — both verdicts are identical
    const base = taskData();
    const vault = taskData({ body: 'vault-digest' });
    const remote = taskData({ status: 'Done' });
    expect(resolver.diff(vault, remote, base)).toEqual(
      resolver.diff(vault, remote, base),
    );
  });
});
