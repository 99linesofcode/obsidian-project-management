import { describe, expect, it } from 'vitest';
import {
  isProjectAffiliationEntry,
  projectAffiliationLink,
} from '../../src/shared/projectAffiliation.js';

describe('projectAffiliationLink', () => {
  it('renders the underscore form that resolves to the home note', () => {
    // Given — a project

    // When — its affiliation entry is rendered
    const link = projectAffiliationLink('Acme Widgets');

    // Then — the underscore-prefixed stem is the resolving link
    expect(link).toBe('[[_Acme Widgets]]');
  });
});

describe('isProjectAffiliationEntry', () => {
  it('accepts the pre-rename project form', () => {
    // Given — a note written before the rename migration

    // When — the project entry is tested
    const isProject = isProjectAffiliationEntry('Acme Widgets', 'Acme Widgets');

    // Then — it counts as the project
    expect(isProject).toBe(true);
  });

  it('accepts the post-rename underscore form', () => {
    // Given — a note Obsidian rewrote to the new home stem

    // When — the project entry is tested
    const isProject = isProjectAffiliationEntry(
      '_Acme Widgets',
      'Acme Widgets',
    );

    // Then — it counts as the project
    expect(isProject).toBe(true);
  });

  it('rejects a parent whose name merely starts with an underscore', () => {
    // Given — a parent note named with a leading underscore

    // When — it is tested against a different project
    const isProject = isProjectAffiliationEntry('_parent', 'Acme Widgets');

    // Then — the underscore is not blanket-stripped; it is not the project
    expect(isProject).toBe(false);
  });

  it('rejects an unrelated target', () => {
    // Given — a slice link

    // When — it is tested against the project
    const isProject = isProjectAffiliationEntry('40-slice-1', 'Acme Widgets');

    // Then — it is not the project entry
    expect(isProject).toBe(false);
  });
});
