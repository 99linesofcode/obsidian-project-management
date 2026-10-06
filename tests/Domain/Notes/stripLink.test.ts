import { describe, expect, it } from 'vitest';
import { stripLink } from '../../../src/Domain/Notes/stripLink.js';

describe('stripLink', () => {
  it('strips the brackets from a plain wikilink', () => {
    // Given — a plain wikilink

    // When — the target is read
    const target = stripLink('[[42-fix-the-bug]]');

    // Then — only the target remains
    expect(target).toBe('42-fix-the-bug');
  });

  it('strips a display alias', () => {
    // Given — a wikilink with a display alias

    // When — the target is read
    const target = stripLink('[[40-slice-1|Slice 1]]');

    // Then — the alias is dropped
    expect(target).toBe('40-slice-1');
  });

  it('trims surrounding whitespace', () => {
    // Given — a wikilink with padded content

    // When — the target is read
    const target = stripLink('[[ 42-fix-the-bug ]]');

    // Then — the target is trimmed
    expect(target).toBe('42-fix-the-bug');
  });
});
