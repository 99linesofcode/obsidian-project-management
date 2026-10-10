import { describe, expect, it } from 'vitest';
import {
  isProjectAffiliationEntry,
  projectAffiliationLink,
} from '../../../src/core/domain/projectAffiliation.js';

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
