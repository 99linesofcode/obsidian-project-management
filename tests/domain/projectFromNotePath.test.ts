import { describe, expect, it } from 'vitest';
import { projectFromNotePath } from '../../src/domain/projectFromNotePath.js';

describe('DISC-3 — a project under Archief is the same project, archived', () => {
  it('keys both roots to the same project name, so archiving never re-keys identity', () => {
    expect(
      projectFromNotePath('Projecten/Acme Widgets/taken/42-fix-the-bug.md'),
    ).toBe('Acme Widgets');
    expect(
      projectFromNotePath('Archief/Acme Widgets/taken/42-fix-the-bug.md'),
    ).toBe('Acme Widgets');
    expect(projectFromNotePath('Archief/Acme Widgets/_Acme Widgets.md')).toBe(
      'Acme Widgets',
    );
  });
});

describe('DISC-4 — only the project root names the project', () => {
  it('returns the second segment for a nested note, and empty for a non-project path', () => {
    expect(
      projectFromNotePath('Projecten/Acme Widgets/taken/nested/deep.md'),
    ).toBe('Acme Widgets');
    expect(projectFromNotePath('Templates/ToDo.md')).toBe('');
    expect(projectFromNotePath('taken/42-orphan.md')).toBe('');
  });
});
