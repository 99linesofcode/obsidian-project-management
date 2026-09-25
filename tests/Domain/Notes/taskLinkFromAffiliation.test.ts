import { describe, expect, it } from 'vitest';
import { taskLinkFromAffiliation } from '../../../src/Domain/Notes/taskLinkFromAffiliation.js';

describe('taskLinkFromAffiliation', () => {
  it('returns the first link that is not the project', () => {
    // Given — an affiliation listing the project then the task

    // When — the task link is read
    const link = taskLinkFromAffiliation(
      ['[[Acme Widgets]]', '[[42-fix-the-bug]]'],
      'Acme Widgets',
    );

    // Then — the task link is returned
    expect(link).toBe('42-fix-the-bug');
  });

  it('strips a display alias from the link', () => {
    // Given — an aliased slice link

    // When — the task link is read
    const link = taskLinkFromAffiliation(
      ['[[Acme Widgets]]', '[[40-slice-1|Slice 1]]'],
      'Acme Widgets',
    );

    // Then — the alias is dropped
    expect(link).toBe('40-slice-1');
  });

  it('returns null when only the project is affiliated', () => {
    // Given — an affiliation with only the project

    // When — the task link is read
    const link = taskLinkFromAffiliation(['[[Acme Widgets]]'], 'Acme Widgets');

    // Then — there is no task link
    expect(link).toBeNull();
  });
});
