import { describe, expect, it } from 'vitest';
import { typeFromLabels } from '../../src/domain/typeFromLabels.js';

describe('MAT-3 — the type gate reads the type label', () => {
  it('reads the type from a spaced type label', () => {
    expect(typeFromLabels(['type: task', 'bug'])).toBe('task');
  });

  it('reads the type from a legacy no-space type label', () => {
    expect(typeFromLabels(['type:bug'])).toBe('bug');
  });

  it('returns empty when no type label is present', () => {
    expect(typeFromLabels(['bug', 'chore'])).toBe('');
  });

  it('never mistakes an arbitrary non-type label for the type', () => {
    expect(typeFromLabels(['priority:high'])).toBe('');
  });
});
