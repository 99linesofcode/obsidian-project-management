import { describe, expect, it } from 'vitest';
import { typeFromLabels } from '../../../src/Domain/Labels/typeFromLabels.js';

describe('typeFromLabels', () => {
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
    // Given — a user label that is not a type
    // When — the type is read
    // Then — it is empty, not 'priority:high'
    expect(typeFromLabels(['priority:high'])).toBe('');
  });
});
