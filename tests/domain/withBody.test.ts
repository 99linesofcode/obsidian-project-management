import { describe, expect, it } from 'vitest';
import { withBody } from '../../src/domain/withBody.js';

describe('DISC-2 — a note body is replaced in place', () => {
  it('replaces the body and keeps the frontmatter verbatim', () => {
    const content = ['---', 'status: open', '---', 'Old body'].join('\n');

    const updated = withBody(content, 'New body');

    expect(updated).toBe(['---', 'status: open', '---', 'New body'].join('\n'));
  });

  it('replaces the whole note when it has no frontmatter', () => {
    const updated = withBody('Just prose.', 'New body');

    expect(updated).toBe('New body');
  });

  it('replaces the whole note when the frontmatter is never closed', () => {
    const updated = withBody(['---', 'status: open'].join('\n'), 'New body');

    expect(updated).toBe('New body');
  });
});
