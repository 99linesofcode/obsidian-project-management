import { describe, expect, it } from 'vitest';
import { VerdictResolver } from '../../../src/Domain/Reconciliation/VerdictResolver.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';

const snapshot: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  todoistId: '',
  notePath: 'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
  title: 'Fix the bug',
  body: 'The bug happens on resize.',
  status: 'Building',
  completed: false,
  parent: null,
  labels: [],
  updatedAt: '2026-09-18T10:00:00Z',
};

const resolver = new VerdictResolver();

describe('VerdictResolver.diff', () => {
  it('pushes when only the vault changed', () => {
    // Given — the vault body moved, the remote did not
    const vault = { ...snapshot, body: 'The bug now also happens on resize.' };

    // When — the canonical diff runs
    const verdict = resolver.diff(vault, snapshot, snapshot);

    // Then — the vault change is pushed
    expect(verdict).toBe('push');
  });

  it('pulls when only the remote changed', () => {
    // Given — the remote status moved, the vault did not
    const remote = { ...snapshot, status: 'Shipped' };

    // When — the canonical diff runs
    const verdict = resolver.diff(snapshot, remote, snapshot);

    // Then — the remote change is pulled
    expect(verdict).toBe('pull');
  });

  it('conflicts (vault wins) when both sides changed', () => {
    // Given — both the vault and the remote moved
    const vault = { ...snapshot, body: 'Vault edit.' };
    const remote = { ...snapshot, status: 'Shipped' };

    // When — the canonical diff runs
    const verdict = resolver.diff(vault, remote, snapshot);

    // Then — the conflict resolves to the vault
    expect(verdict).toBe('conflict');
  });

  it('does nothing when neither side changed', () => {
    // Given — vault, remote and snapshot all agree

    // When — the canonical diff runs
    const verdict = resolver.diff(snapshot, snapshot, snapshot);

    // Then — there is nothing to do
    expect(verdict).toBe('none');
  });

  it('ignores identity fields', () => {
    // Given — only the identity fields differ
    const vault = {
      ...snapshot,
      notePath: 'Projecten/Acme Widgets/taken/renamed.md',
    };
    const remote = { ...snapshot, updatedAt: '2026-09-18T11:00:00Z' };

    // When — the canonical diff runs
    const verdict = resolver.diff(vault, remote, snapshot);

    // Then — identity drift is not a content change
    expect(verdict).toBe('none');
  });

  it('is deterministic for the same input', () => {
    // Given — a scenario where both sides changed
    const vault = { ...snapshot, body: 'Vault edit.' };
    const remote = { ...snapshot, status: 'Shipped' };

    // When — the diff runs twice
    const first = resolver.diff(vault, remote, snapshot);
    const second = resolver.diff(vault, remote, snapshot);

    // Then — both verdicts are identical
    expect(second).toBe(first);
  });
});
