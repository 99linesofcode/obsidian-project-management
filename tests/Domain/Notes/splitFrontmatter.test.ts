import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../../../src/Domain/Notes/splitFrontmatter.js';

describe('splitFrontmatter', () => {
  it('splits the fields from the body', () => {
    // Given — a note with frontmatter and a body
    const content = [
      '---',
      'url: https://example.com/1',
      'status: open',
      '---',
      'Body line.',
    ].join('\n');

    // When — the note is split
    const split = splitFrontmatter(content);

    // Then — the fields and body are separated
    expect(split?.fields.get('url')).toBe('https://example.com/1');
    expect(split?.fields.get('status')).toBe('open');
    expect(split?.body).toBe('Body line.');
  });

  it('keeps a colon inside a value', () => {
    // Given — a field whose value contains a colon
    const content = ['---', 'url: https://example.com/1', '---', ''].join('\n');

    // When — the note is split
    const split = splitFrontmatter(content);

    // Then — only the first colon separates key from value
    expect(split?.fields.get('url')).toBe('https://example.com/1');
  });

  it('returns null when there is no frontmatter block', () => {
    // Given — a plain note

    // When — the note is split
    const split = splitFrontmatter('Just a note.');

    // Then — there is no frontmatter
    expect(split).toBeNull();
  });

  it('returns null when the frontmatter is never closed', () => {
    // Given — an unclosed frontmatter block
    const content = ['---', 'status: open', ''].join('\n');

    // When — the note is split
    const split = splitFrontmatter(content);

    // Then — there is no frontmatter
    expect(split).toBeNull();
  });
});
