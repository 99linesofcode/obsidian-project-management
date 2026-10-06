import { describe, expect, it } from 'vitest';
import { VerdictResolver } from '../../src/shared/VerdictResolver.js';
import type { ConflictHints } from '../../src/shared/VerdictResolver.js';
import { taskData } from '../helpers/records.js';

const DONE_LANE = 'Done';
const resolver = new VerdictResolver(DONE_LANE);

const noHints: ConflictHints = { vaultModifiedAt: null, remoteFieldTimes: {} };

function ladder(
  vault = taskData(),
  remote = taskData(),
  base = taskData(),
  hints: ConflictHints = noHints,
) {
  return resolver.resolveConflicts(
    vault,
    remote,
    resolver.diff(vault, remote, base),
    hints,
  );
}

describe('SYNC-3 — the decision ladder resolves every field', () => {
  it('uses a decisive timestamp only when it postdates the vault clock', () => {
    const cases: Array<{
      name: string;
      base: ReturnType<typeof taskData>;
      vault: ReturnType<typeof taskData>;
      remote: ReturnType<typeof taskData>;
      hints: ConflictHints;
      field: 'status' | 'title';
      expected: 'push' | 'pull';
    }> = [
      {
        name: 'remote postdates the vault',
        base: taskData({ status: 'Building' }),
        vault: taskData({
          status: 'Done',
          completedAt: '2026-09-18T12:00:00Z',
        }),
        remote: taskData({ status: 'Backlog' }),
        hints: {
          vaultModifiedAt: '2026-09-18T11:00:00Z',
          remoteFieldTimes: { status: '2026-09-18T13:00:00Z' },
        },
        field: 'status',
        expected: 'pull',
      },
      {
        name: 'the vault clock is unknown',
        base: taskData({ status: 'Building' }),
        vault: taskData({
          status: 'Done',
          completedAt: '2026-09-18T12:00:00Z',
        }),
        remote: taskData({ status: 'Backlog' }),
        hints: {
          vaultModifiedAt: null,
          remoteFieldTimes: { status: '2026-09-18T13:00:00Z' },
        },
        field: 'status',
        expected: 'push',
      },
      {
        name: 'the remote field time is not later',
        base: taskData({ title: 'Fix the bug' }),
        vault: taskData({ title: 'Vault title' }),
        remote: taskData({ title: 'Remote title' }),
        hints: {
          vaultModifiedAt: '2026-09-18T11:00:00Z',
          remoteFieldTimes: { title: '2026-09-18T09:00:00Z' },
        },
        field: 'title',
        expected: 'push',
      },
    ];
    for (const c of cases) {
      expect(ladder(c.vault, c.remote, c.base, c.hints)[c.field], c.name).toBe(
        c.expected,
      );
    }
  });

  it('lets a completion beat a stale open state, in either direction', () => {
    const cases: Array<{
      name: string;
      vault: ReturnType<typeof taskData>;
      remote: ReturnType<typeof taskData>;
      expected: 'push' | 'pull';
    }> = [
      {
        name: 'vault completed, remote stale',
        vault: taskData({
          status: 'Done',
          completedAt: '2026-09-18T12:00:00Z',
        }),
        remote: taskData({ status: 'Backlog' }),
        expected: 'push',
      },
      {
        name: 'remote completed, vault stale',
        vault: taskData({ status: 'Backlog' }),
        remote: taskData({
          status: 'Done',
          completedAt: '2026-09-18T12:00:00Z',
        }),
        expected: 'pull',
      },
      {
        name: 'both done: the vault wins',
        vault: taskData({
          status: 'Done',
          completedAt: '2026-09-18T12:00:00Z',
        }),
        remote: taskData({
          status: 'Shipped',
          completedAt: '2026-09-18T13:00:00Z',
        }),
        expected: 'push',
      },
      {
        name: 'both open: the vault wins',
        vault: taskData({ status: 'Backlog' }),
        remote: taskData({ status: 'Triage' }),
        expected: 'push',
      },
    ];
    for (const c of cases) {
      expect(
        ladder(c.vault, c.remote, taskData({ status: 'Building' })).status,
        c.name,
      ).toBe(c.expected);
    }
  });

  it('falls back to origin authority for a non-status conflict', () => {
    const base = taskData({ body: 'base-digest' });
    const vault = taskData({ body: 'vault-digest' });
    const remote = taskData({ body: 'remote-digest' });

    expect(ladder(vault, remote, base).body).toBe('push');
    expect(ladder(vault, remote, base)).toEqual(ladder(vault, remote, base));
  });

  it('leaves already-decided verdicts untouched', () => {
    const resolved = ladder(
      taskData({ body: 'vault-digest' }),
      taskData({ status: 'Done' }),
      taskData(),
    );

    expect(resolved.body).toBe('push');
    expect(resolved.status).toBe('pull');
  });
});
