import { describe, expect, it } from 'vitest';
import { projectFromTodoPath } from '../../../src/Domain/Notes/projectFromTodoPath.js';

describe('projectFromTodoPath', () => {
  it('reads the project from a to-do path', () => {
    // Given — a to-do note path

    // When — the project is read
    const project = projectFromTodoPath(
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    );

    // Then — the project name is returned
    expect(project).toBe('Acme Widgets');
  });

  it('returns null for a task path', () => {
    // Given — a task note path

    // When — the project is read
    const project = projectFromTodoPath(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
    );

    // Then — it is not a to-do path
    expect(project).toBeNull();
  });

  it('returns null for a path outside the vault convention', () => {
    // Given — an unrelated path

    // When — the project is read
    const project = projectFromTodoPath('Notes/random.md');

    // Then — it is not a to-do path
    expect(project).toBeNull();
  });
});
