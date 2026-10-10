import { describe, expect, it } from 'vitest';
import { stemOf } from '../../../src/core/domain/stemOf.js';

describe('REN-1 — a note stem survives a rename', () => {
  it('returns the basename without the .md extension', () => {
    const stem = stemOf('Projecten/Acme Widgets/taken/42-fix-the-bug.md');

    expect(stem).toBe('42-fix-the-bug');
  });

  it('returns a bare filename unchanged', () => {
    const stem = stemOf('note.md');

    expect(stem).toBe('note');
  });
});
