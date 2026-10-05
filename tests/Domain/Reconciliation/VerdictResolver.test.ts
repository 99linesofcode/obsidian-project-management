import { describe, expect, it } from 'vitest';
import { VerdictResolver } from '../../../src/Domain/Reconciliation/VerdictResolver.js';
import type { ConflictHints } from '../../../src/Domain/Reconciliation/VerdictResolver.js';
import { taskData } from './taskView.js';

const DONE_LANE = 'Done';
const resolver = new VerdictResolver(DONE_LANE);

const noHints: ConflictHints = { vaultModifiedAt: null, remoteFieldTimes: {} };

// The ladder runs on the diff's verdicts, so each scenario first attributes the
// three views and then arbitrates the conflicts.
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

describe('VerdictResolver.resolveConflicts', () => {
  describe('decisive timestamp', () => {
    it('pulls a conflict when the remote field time postdates the vault mtime', () => {
      // Given — both sides changed status, and the remote change provably came
      // after every local edit
      const base = taskData({ status: 'Building' });
      const vault = taskData({
        status: 'Done',
        completedAt: '2026-09-18T12:00:00Z',
      });
      const remote = taskData({ status: 'Backlog' });
      const hints: ConflictHints = {
        vaultModifiedAt: '2026-09-18T11:00:00Z',
        remoteFieldTimes: { status: '2026-09-18T13:00:00Z' },
      };

      // When — the ladder arbitrates

      // Then — the remote wins on the decisive timestamp
      expect(ladder(vault, remote, base, hints).status).toBe('pull');
    });

    it('falls back when the vault mtime is unknown', () => {
      // Given — a remote field time but no vault mtime to compare it against
      const base = taskData({ status: 'Building' });
      const vault = taskData({
        status: 'Done',
        completedAt: '2026-09-18T12:00:00Z',
      });
      const remote = taskData({ status: 'Backlog' });
      const hints: ConflictHints = {
        vaultModifiedAt: null,
        remoteFieldTimes: { status: '2026-09-18T13:00:00Z' },
      };

      // When — the ladder arbitrates

      // Then — it falls through to the semantic rule (vault completion wins)
      expect(ladder(vault, remote, base, hints).status).toBe('push');
    });

    it('falls back when the remote field time is not later', () => {
      // Given — both sides changed a title, and the remote time predates the
      // vault mtime
      const base = taskData({ title: 'Fix the bug' });
      const vault = taskData({ title: 'Vault title' });
      const remote = taskData({ title: 'Remote title' });
      const hints: ConflictHints = {
        vaultModifiedAt: '2026-09-18T11:00:00Z',
        remoteFieldTimes: { title: '2026-09-18T09:00:00Z' },
      };

      // When — the ladder arbitrates

      // Then — origin authority holds
      expect(ladder(vault, remote, base, hints).title).toBe('push');
    });
  });

  describe('done-beats-open', () => {
    it('pushes a vault completion over a stale remote', () => {
      // Given — the vault completed while the remote moved to another open lane
      const base = taskData({ status: 'Building' });
      const vault = taskData({
        status: 'Done',
        completedAt: '2026-09-18T12:00:00Z',
      });
      const remote = taskData({ status: 'Backlog' });

      // When — the ladder arbitrates

      // Then — the completion wins and the remote reopen is vetoed
      expect(ladder(vault, remote, base).status).toBe('push');
    });

    it('pulls a remote completion over a stale vault', () => {
      // Given — the remote completed while the vault moved to another open lane
      const base = taskData({ status: 'Building' });
      const vault = taskData({ status: 'Backlog' });
      const remote = taskData({
        status: 'Done',
        completedAt: '2026-09-18T12:00:00Z',
      });

      // When — the ladder arbitrates

      // Then — the completion wins and the vault reopen is vetoed
      expect(ladder(vault, remote, base).status).toBe('pull');
    });

    it('pushes the vault value when both sides are done', () => {
      // Given — both sides completed under different lane names
      const base = taskData({ status: 'Building' });
      const vault = taskData({
        status: 'Done',
        completedAt: '2026-09-18T12:00:00Z',
      });
      const remote = taskData({
        status: 'Shipped',
        completedAt: '2026-09-18T13:00:00Z',
      });

      // When — the ladder arbitrates

      // Then — origin authority applies: the vault's lane wins and the mirror
      // catches up, so the divergence is never left undecided
      expect(ladder(vault, remote, base).status).toBe('push');
    });

    it('pushes the vault value when both sides are open', () => {
      // Given — both sides moved to different open lanes
      const base = taskData({ status: 'Building' });
      const vault = taskData({ status: 'Backlog' });
      const remote = taskData({ status: 'Triage' });

      // When — the ladder arbitrates

      // Then — origin authority applies: the vault's lane wins and the mirror
      // catches up, so the divergence is never left undecided
      expect(ladder(vault, remote, base).status).toBe('push');
    });
  });

  describe('origin authority', () => {
    it('pushes a non-status conflict when no timestamp is decisive', () => {
      // Given — both sides changed the body with no timing evidence
      const base = taskData({ body: 'base-digest' });
      const vault = taskData({ body: 'vault-digest' });
      const remote = taskData({ body: 'remote-digest' });

      // When — the ladder arbitrates

      // Then — the vault wins
      expect(ladder(vault, remote, base).body).toBe('push');
    });

    it('leaves already-decided verdicts untouched', () => {
      // Given — a vault-only body push and a remote-only status pull
      const base = taskData();
      const vault = taskData({ body: 'vault-digest' });
      const remote = taskData({ status: 'Done' });

      // When — the ladder arbitrates

      // Then — the non-conflicts pass through
      const resolved = ladder(vault, remote, base);
      expect(resolved.body).toBe('push');
      expect(resolved.status).toBe('pull');
    });

    it('is deterministic for the same input', () => {
      // Given — a conflicted body
      const base = taskData({ body: 'base-digest' });
      const vault = taskData({ body: 'vault-digest' });
      const remote = taskData({ body: 'remote-digest' });

      // When — the ladder runs twice

      // Then — both results are identical
      expect(ladder(vault, remote, base)).toEqual(ladder(vault, remote, base));
    });
  });
});
