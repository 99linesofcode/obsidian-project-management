import { describe, expect, it, vi } from 'vitest';
import {
  comparisonForm,
  renderFilename,
} from '../../../src/core/domain/note.js';

// S32 — "the filename is the title". The renderer and the comparison form are
// two functions and must stay two: the renderer preserves case and spacing and
// produces the filename; the comparison form is deliberately lossy and exists
// only to match two notes. A single function cannot do both, so this suite
// pins them apart.

describe('FN-1 — the renderer produces the filename verbatim', () => {
  it('renders a colon as a space, never a dash', () => {
    expect(renderFilename('fix: a to-do twin')).toBe('fix a to-do twin.md');
  });

  it('preserves case and collapses runs of whitespace', () => {
    expect(renderFilename('Fix the Bug')).toBe('Fix the Bug.md');
    expect(renderFilename('Fix  the  Bug')).toBe('Fix the Bug.md');
  });

  it('does not introduce dashes and adds or strips no prefix', () => {
    expect(renderFilename('fix-a-twin')).toBe('fix-a-twin.md');
    expect(renderFilename('fix the bug')).toBe('fix the bug.md');
    expect(renderFilename('61-fix the bug')).toBe('61-fix the bug.md');
  });

  it.each(['<', '>', ':', '"', '/', '\\', '|', '?', '*'])(
    'renders the illegal character %s as a single space',
    (character) => {
      expect(renderFilename(`a${character}b`)).toBe('a b.md');
    },
  );

  it('renders a control character as a space', () => {
    expect(renderFilename('a\u0001b')).toBe('a b.md');
    expect(renderFilename('a\tb')).toBe('a b.md');
  });

  it('collapses a run of illegal characters and whitespace to one space', () => {
    expect(renderFilename('a<>  : b')).toBe('a b.md');
  });
});

describe('FN-1 — an unrenderable title is refused, never silently truncated', () => {
  it.each([
    ['an empty title', ''],
    ['a title that renders empty', ':'],
    ['a title that renders empty from whitespace', '   '],
    ['a single dot', '.'],
    ['two dots', '..'],
    ['all dots', '...'],
    ['a title ending in a dot', 'Fix the bug.'],
    ['a title ending in a space', 'Fix the bug '],
  ])('refuses %s', (_label, title) => {
    const attempt = () => renderFilename(title);

    expect(attempt).toThrow();
    expect(attempt).not.toThrow(TypeError);
  });

  it('names the title in the refusal', () => {
    for (const title of ['...', 'Fix the bug.', 'Fix the bug ']) {
      expect(() => renderFilename(title)).toThrow(title.trim());
    }
  });
});

describe('FN-1 — the render is capped at 255 bytes, on a word boundary, and reported', () => {
  it('truncates at a word boundary and reports the truncation', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const title = Array.from({ length: 60 }, () => 'word').join(' ');

    const rendered = renderFilename(title);
    const stem = rendered.replace(/\.md$/, '');

    expect(Buffer.byteLength(stem)).toBeLessThanOrEqual(255);
    expect(title.startsWith(stem)).toBe(true);
    expect(title[stem.length]).toBe(' ');
    expect(warn.mock.calls.length + error.mock.calls.length).toBeGreaterThan(0);

    warn.mockRestore();
    error.mockRestore();
  });
});

describe('FN-1 — the comparison form is lossy; the renderer is not', () => {
  it('case-folds and collapses whitespace', () => {
    expect(comparisonForm('Fix  the  Bug')).toBe('fix the bug');
  });

  it('strips a leading ordinal and a trailing collision suffix', () => {
    expect(comparisonForm('61-fix the bug')).toBe('fix the bug');
    expect(comparisonForm('fix the bug-2')).toBe('fix the bug');
    expect(comparisonForm('61-fix the bug.md')).toBe('fix the bug');
  });

  it('matches two notes differing in case, whitespace and ordinal where the renderer does not', () => {
    expect(comparisonForm('61-Fix  the Bug')).toBe(
      comparisonForm('fix the bug'),
    );
    expect(renderFilename('Fix the Bug')).not.toBe(
      renderFilename('fix the bug'),
    );
  });
});
