import { describe, expect, it } from 'vitest';
import { Baseline } from '../../../src/core/application/data/Baseline.js';
import { SideObservation } from '../../../src/core/domain/SideObservation.js';
import type { SideRole } from '../../../src/core/domain/SideObservation.js';
import { mergeField } from '../../../src/core/domain/mergeField.js';

function side(init: {
  side: string;
  role?: SideRole;
  current?: string | null;
  baseline?: Baseline | null;
  fieldTime?: string | null;
  timestampTrustworthy?: boolean;
  completeFetch?: boolean;
  currentCompleted?: boolean;
}): SideObservation {
  return new SideObservation({
    side: init.side,
    role: init.role ?? 'mirror',
    current: init.current ?? null,
    baseline: init.baseline ?? null,
    fieldTime: init.fieldTime ?? null,
    timestampTrustworthy: init.timestampTrustworthy ?? false,
    completeFetch: init.completeFetch ?? false,
    currentCompleted: init.currentCompleted ?? false,
  });
}

const synced = (value: string, completed = false): Baseline =>
  new Baseline(value, completed);

describe('mergeField — a single delta wins outright (NWM-2, NWM-3)', () => {
  it('takes the lone origin change as the reconciled value', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: 'New',
        baseline: synced('Base'),
      }),
      [side({ side: 'alpha', current: 'Base', baseline: synced('Base') })],
    );

    expect(result.outcome).toBe('value');
    expect(result.value).toBe('New');
    expect(result.winner).toBe('vault');
    expect(result.rung).toBe(0);
  });
});

describe('mergeField — a quiet field stays quiet (NWM-4)', () => {
  it('produces no delta and writes nothing when every side matches its baseline', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: 'Base',
        baseline: synced('Base'),
      }),
      [side({ side: 'alpha', current: 'Base', baseline: synced('Base') })],
    );

    expect(result.outcome).toBe('unchanged');
    expect(result.deltas).toHaveLength(0);
  });
});

describe('mergeField — the decisive-timestamp rung (NWM-6)', () => {
  it('selects the provably-newest trustworthy delta across mirrors', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: 'Base',
        baseline: synced('Base'),
      }),
      [
        side({
          side: 'alpha',
          current: 'Alpha',
          baseline: synced('Base'),
          fieldTime: '2026-10-08T11:00:00Z',
          timestampTrustworthy: true,
        }),
        side({
          side: 'beta',
          current: 'Beta',
          baseline: synced('Base'),
          fieldTime: '2026-10-08T10:00:00Z',
          timestampTrustworthy: true,
        }),
      ],
    );

    expect(result.rung).toBe(1);
    expect(result.winner).toBe('alpha');
    expect(result.value).toBe('Alpha');
  });

  it('is order-independent (NWM-1)', () => {
    const alpha = side({
      side: 'alpha',
      current: 'Alpha',
      baseline: synced('Base'),
      fieldTime: '2026-10-08T11:00:00Z',
      timestampTrustworthy: true,
    });
    const beta = side({
      side: 'beta',
      current: 'Beta',
      baseline: synced('Base'),
      fieldTime: '2026-10-08T10:00:00Z',
      timestampTrustworthy: true,
    });
    const origin = side({
      side: 'vault',
      role: 'origin',
      current: 'Base',
      baseline: synced('Base'),
    });

    const forward = mergeField(origin, [alpha, beta]);
    const reversed = mergeField(origin, [beta, alpha]);

    expect(reversed.winner).toBe(forward.winner);
    expect(reversed.value).toBe(forward.value);
  });
});

describe('mergeField — an untrustworthy clock degrades to the origin (NWM-7, NWM-12)', () => {
  it('lets the origin tie-break decide when the only newer delta is untrustworthy', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: 'Origin',
        baseline: synced('Base'),
        fieldTime: '2026-10-08T10:00:00Z',
      }),
      [
        side({
          side: 'alpha',
          current: 'Remote',
          baseline: synced('Base'),
          fieldTime: '2026-10-08T12:00:00Z',
          timestampTrustworthy: false,
        }),
      ],
    );

    expect(result.rung).toBe(3);
    expect(result.winner).toBe('vault');
    expect(result.value).toBe('Origin');
  });
});

describe('mergeField — the origin clock is trusted by default (NWM-28)', () => {
  it('lets the origin win the timestamp rung without a mirror declaration', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: 'Origin',
        baseline: synced('Base'),
        fieldTime: '2026-10-08T12:00:00Z',
        timestampTrustworthy: false,
      }),
      [
        side({
          side: 'alpha',
          current: 'Remote',
          baseline: synced('Base'),
          fieldTime: '2026-10-08T11:00:00Z',
          timestampTrustworthy: true,
        }),
      ],
    );

    expect(result.rung).toBe(1);
    expect(result.winner).toBe('vault');
    expect(result.value).toBe('Origin');
  });
});

describe('mergeField — equal provable timestamps fall to the origin (NWM-26)', () => {
  it('does not decide on the timestamp rung when two deltas tie', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: 'Base',
        baseline: synced('Base'),
      }),
      [
        side({
          side: 'alpha',
          current: 'Alpha',
          baseline: synced('Base'),
          fieldTime: '2026-10-08T10:00:00Z',
          timestampTrustworthy: true,
        }),
        side({
          side: 'beta',
          current: 'Beta',
          baseline: synced('Base'),
          fieldTime: '2026-10-08T10:00:00Z',
          timestampTrustworthy: true,
        }),
      ],
    );

    expect(result.rung).toBe(3);
    expect(result.winner).toBe('vault');
    expect(result.value).toBe('Base');
  });
});

describe('mergeField — completion over a stale open (NWM-5, NWM-8)', () => {
  it('selects the completion against another mirror still open', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: 'Base',
        baseline: synced('Base'),
      }),
      [
        side({
          side: 'alpha',
          current: 'Done',
          baseline: synced('Base'),
          currentCompleted: true,
        }),
        side({ side: 'beta', current: 'Review', baseline: synced('Base') }),
      ],
    );

    expect(result.rung).toBe(2);
    expect(result.winner).toBe('alpha');
    expect(result.value).toBe('Done');
  });
});

describe('mergeField — delete proof (NWM-10)', () => {
  it('treats a mirror absence without a complete fetch as unchanged', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: 'Base',
        baseline: synced('Base'),
      }),
      [
        side({
          side: 'alpha',
          current: null,
          baseline: synced('Base'),
          completeFetch: false,
        }),
      ],
    );

    expect(result.outcome).toBe('unchanged');
    expect(result.deltas).toHaveLength(0);
  });

  it('treats a verified-complete absence with a synced baseline as a delete', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: 'Base',
        baseline: synced('Base'),
      }),
      [
        side({
          side: 'alpha',
          current: null,
          baseline: synced('Base'),
          completeFetch: true,
        }),
      ],
    );

    expect(result.outcome).toBe('delete');
    expect(result.winner).toBe('alpha');
  });
});

describe('mergeField — the origin absence is a delete delta (NWM-27)', () => {
  it('lets the vault absence delete without a complete-fetch precondition', () => {
    const result = mergeField(
      side({
        side: 'vault',
        role: 'origin',
        current: null,
        baseline: synced('Base'),
        completeFetch: false,
      }),
      [side({ side: 'alpha', current: 'Base', baseline: synced('Base') })],
    );

    expect(result.outcome).toBe('delete');
    expect(result.winner).toBe('vault');
  });
});
