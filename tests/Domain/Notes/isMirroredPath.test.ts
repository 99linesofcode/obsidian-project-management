import { describe, expect, it } from 'vitest';
import { isMirroredPath } from '../../../src/Domain/Notes/isMirroredPath.js';

describe('isMirroredPath', () => {
  it('accepts a task twin path', () => {
    // Given — a task note path

    // When — it is tested
    const mirrored = isMirroredPath(
      'Projecten/Acme Widgets/taken/42-fix-the-bug.md',
      'Acme Widgets',
    );

    // Then — it is a mirrored item
    expect(mirrored).toBe(true);
  });

  it('accepts a to-do twin path', () => {
    // Given — a to-do note path

    // When — it is tested
    const mirrored = isMirroredPath(
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
      'Acme Widgets',
    );

    // Then — it is a mirrored item
    expect(mirrored).toBe(true);
  });

  it('rejects another project', () => {
    // Given — a task path under a different project

    // When — it is tested
    const mirrored = isMirroredPath(
      'Projecten/Other/taken/42-fix-the-bug.md',
      'Acme Widgets',
    );

    // Then — it is not this project's mirrored item
    expect(mirrored).toBe(false);
  });

  it('rejects a path outside the mirrored folders', () => {
    // Given — a project note path

    // When — it is tested
    const mirrored = isMirroredPath(
      'Projecten/Acme Widgets/_home.md',
      'Acme Widgets',
    );

    // Then — it is not a mirrored item
    expect(mirrored).toBe(false);
  });
});
