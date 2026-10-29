import { describe, expect, it } from 'vitest';
import { SEED_ARTIFACTS } from '../../../../src/core/application/actions/templates.js';

// MAT-5 — the seeded note templates lose the `name:` field. The filename is the
// title, so a template that pre-fills `name:` would write a second copy of it.

function artifact(key: string): string {
  return SEED_ARTIFACTS.find((entry) => entry.key === key)?.content ?? '';
}

describe('MAT-5 — the seeded templates carry no name: field', () => {
  it('ships a task template with no name: line', () => {
    expect(artifact('taskTemplate')).not.toMatch(/^name:/m);
  });

  it('ships a project template with no name: line', () => {
    expect(artifact('projectTemplate')).not.toMatch(/^name:/m);
  });
});
