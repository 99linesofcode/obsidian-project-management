import { describe, expect, it } from 'vitest';
import { stripLink } from '../../src/core/stripLink.js';

describe('SYNC-1 — a wikilink is stripped to its target', () => {
  it('strips the brackets from a plain wikilink', () => {
    const target = stripLink('[[42-fix-the-bug]]');

    expect(target).toBe('42-fix-the-bug');
  });

  it('strips a display alias', () => {
    const target = stripLink('[[40-slice-1|Slice 1]]');

    expect(target).toBe('40-slice-1');
  });

  it('trims surrounding whitespace', () => {
    const target = stripLink('[[ 42-fix-the-bug ]]');

    expect(target).toBe('42-fix-the-bug');
  });
});
