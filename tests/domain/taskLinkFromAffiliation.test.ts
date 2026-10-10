import { describe, expect, it } from 'vitest';
import { taskLinkFromAffiliation } from '../../src/domain/taskLinkFromAffiliation.js';

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
