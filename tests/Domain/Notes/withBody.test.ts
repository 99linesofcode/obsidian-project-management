import { describe, expect, it } from 'vitest';
import { withBody } from '../../../src/Domain/Notes/withBody.js';

describe('withBody', () => {
  it('replaces the body and keeps the frontmatter verbatim', () => {
    // Given — a note with frontmatter and an old body
    const content = ['---', 'status: open', '---', 'Old body'].join('\n');

    // When — the body is replaced
    const updated = withBody(content, 'New body');

    // Then — the frontmatter is untouched and the body swapped
    expect(updated).toBe(['---', 'status: open', '---', 'New body'].join('\n'));
  });

  it('replaces the whole note when it has no frontmatter', () => {
    // Given — a plain note with no frontmatter

    // When — the body is replaced
    const updated = withBody('Just prose.', 'New body');

    // Then — the content becomes the new body
    expect(updated).toBe('New body');
  });

  it('replaces the whole note when the frontmatter is never closed', () => {
    // Given — a malformed frontmatter block

    // When — the body is replaced
    const updated = withBody(['---', 'status: open'].join('\n'), 'New body');

    // Then — the content becomes the new body
    expect(updated).toBe('New body');
  });
});
