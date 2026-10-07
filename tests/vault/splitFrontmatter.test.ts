import { describe, expect, it } from 'vitest';
import { splitFrontmatter } from '../../src/vault/splitFrontmatter.js';

describe('DISC-2 — frontmatter is split from the body', () => {
  it('splits the fields from the body', () => {
    const content = [
      '---',
      'url: https://example.com/1',
      'status: open',
      '---',
      'Body line.',
    ].join('\n');

    const split = splitFrontmatter(content);

    expect(split?.fields.get('url')).toBe('https://example.com/1');
    expect(split?.fields.get('status')).toBe('open');
    expect(split?.body).toBe('Body line.');
  });

  it('keeps a colon inside a value', () => {
    const content = ['---', 'url: https://example.com/1', '---', ''].join('\n');

    const split = splitFrontmatter(content);

    expect(split?.fields.get('url')).toBe('https://example.com/1');
  });

  it('returns null when there is no frontmatter block', () => {
    const split = splitFrontmatter('Just a note.');

    expect(split).toBeNull();
  });

  it('returns null when the frontmatter is never closed', () => {
    const content = ['---', 'status: open', ''].join('\n');

    const split = splitFrontmatter(content);

    expect(split).toBeNull();
  });
});
