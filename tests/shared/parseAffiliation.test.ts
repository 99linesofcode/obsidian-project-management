import { describe, expect, it } from 'vitest';
import { parseAffiliation } from '../../src/shared/parseAffiliation.js';

describe('SUB-1 — affiliation names the parent note', () => {
  it('reads each quoted wikilink verbatim', () => {
    const raw = '["[[Acme Widgets]]", "[[42-fix-the-bug]]"]';

    const links = parseAffiliation(raw);

    expect(links).toEqual(['[[Acme Widgets]]', '[[42-fix-the-bug]]']);
  });

  it('returns an empty list for an undefined field', () => {
    const links = parseAffiliation(undefined);

    expect(links).toEqual([]);
  });

  it('returns an empty list for an empty value', () => {
    const links = parseAffiliation('');

    expect(links).toEqual([]);
  });

  it('keeps a display alias inside the link', () => {
    const raw = '["[[40-slice-1|Slice 1]]"]';

    const links = parseAffiliation(raw);

    expect(links).toEqual(['[[40-slice-1|Slice 1]]']);
  });
});
