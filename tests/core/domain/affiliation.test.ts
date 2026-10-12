import { describe, expect, it } from 'vitest';
import {
  isProjectAffiliationEntry,
  parseAffiliation,
  projectAffiliationLink,
  stripLink,
  taskLinkFromAffiliation,
} from '../../../src/core/domain/affiliation.js';

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

describe('SUB-1 — affiliation links the project and parent', () => {
  it('renders the underscore form that resolves to the home note', () => {
    const link = projectAffiliationLink('Acme Widgets');

    expect(link).toBe('[[_Acme Widgets]]');
  });
});

describe('isProjectAffiliationEntry', () => {
  it('accepts the pre-rename project form', () => {
    const isProject = isProjectAffiliationEntry('Acme Widgets', 'Acme Widgets');

    expect(isProject).toBe(true);
  });

  it('accepts the post-rename underscore form', () => {
    const isProject = isProjectAffiliationEntry(
      '_Acme Widgets',
      'Acme Widgets',
    );

    expect(isProject).toBe(true);
  });

  it('rejects a parent whose name merely starts with an underscore', () => {
    const isProject = isProjectAffiliationEntry('_parent', 'Acme Widgets');

    expect(isProject).toBe(false);
  });

  it('rejects an unrelated target', () => {
    const isProject = isProjectAffiliationEntry('40-slice-1', 'Acme Widgets');

    expect(isProject).toBe(false);
  });
});

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

describe('SUB-1 — the actionable parent is read from affiliation', () => {
  it('returns the first link that is not the project', () => {
    const link = taskLinkFromAffiliation(
      ['[[Acme Widgets]]', '[[42-fix-the-bug]]'],
      'Acme Widgets',
    );

    expect(link).toBe('42-fix-the-bug');
  });

  it('strips a display alias from the link', () => {
    const link = taskLinkFromAffiliation(
      ['[[Acme Widgets]]', '[[40-slice-1|Slice 1]]'],
      'Acme Widgets',
    );

    expect(link).toBe('40-slice-1');
  });

  it('returns null when only the project is affiliated', () => {
    const link = taskLinkFromAffiliation(['[[Acme Widgets]]'], 'Acme Widgets');

    expect(link).toBeNull();
  });

  it('does not mistake the renamed project entry for a parent link', () => {
    const link = taskLinkFromAffiliation(
      ['[[_Acme Widgets]]', '[[42-fix-the-bug]]'],
      'Acme Widgets',
    );

    expect(link).toBe('42-fix-the-bug');
  });

  it('returns null when only the renamed project entry is affiliated', () => {
    const link = taskLinkFromAffiliation(['[[_Acme Widgets]]'], 'Acme Widgets');

    expect(link).toBeNull();
  });
});
