import { describe, expect, it } from 'vitest';
import { stemOf } from '../../../src/Domain/Notes/stemOf.js';

describe('stemOf', () => {
  it('returns the basename without the .md extension', () => {
    // Given — a nested note path

    // When — the stem is read
    const stem = stemOf('Projecten/Acme Widgets/taken/42-fix-the-bug.md');

    // Then — only the filename stem remains
    expect(stem).toBe('42-fix-the-bug');
  });

  it('returns a bare filename unchanged', () => {
    // Given — a path with no folder

    // When — the stem is read
    const stem = stemOf('note.md');

    // Then — the extension is stripped
    expect(stem).toBe('note');
  });
});
