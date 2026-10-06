import { describe, expect, it } from 'vitest';
import { projectFromTodoPath } from '../../src/todos/projectFromTodoPath.js';

describe('TODO-1 — a to-do path names its project', () => {
  it('reads the project from a to-do path', () => {

    const project = projectFromTodoPath(
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    );

    expect(project).toBe('Acme Widgets');
  });

  it('returns null for a task path', () => {

    const project = projectFromTodoPath(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );

    expect(project).toBeNull();
  });

  it('returns null for a path outside the vault convention', () => {

    const project = projectFromTodoPath('Notes/random.md');

    expect(project).toBeNull();
  });
});
