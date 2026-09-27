import { describe, expect, it } from 'vitest';
import { parseAffiliation } from '../../../src/Domain/Notes/parseAffiliation.js';

describe('parseAffiliation', () => {
  it('reads each quoted wikilink verbatim', () => {
    // Given — a quoted wikilink list
    const raw = '["[[Acme Widgets]]", "[[42-fix-the-bug]]"]';

    // When — the affiliation is parsed
    const links = parseAffiliation(raw);

    // Then — each link is preserved with its brackets
    expect(links).toEqual(['[[Acme Widgets]]', '[[42-fix-the-bug]]']);
  });

  it('returns an empty list for an undefined field', () => {
    // Given — a note with no affiliation field

    // When — the affiliation is parsed
    const links = parseAffiliation(undefined);

    // Then — there are no links
    expect(links).toEqual([]);
  });

  it('returns an empty list for an empty value', () => {
    // Given — an empty affiliation value

    // When — the affiliation is parsed
    const links = parseAffiliation('');

    // Then — there are no links
    expect(links).toEqual([]);
  });

  it('keeps a display alias inside the link', () => {
    // Given — a link with a display alias
    const raw = '["[[40-slice-1|Slice 1]]"]';

    // When — the affiliation is parsed
    const links = parseAffiliation(raw);

    // Then — the alias is preserved (stripping is the reader's job)
    expect(links).toEqual(['[[40-slice-1|Slice 1]]']);
  });
});
