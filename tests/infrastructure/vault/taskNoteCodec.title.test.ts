import { describe, expect, it } from 'vitest';
import { parseTaskNote } from '../../../src/infrastructure/vault/taskNoteCodec.js';

// NWM-28 — the canonical title reads the filename. It is the file's stem,
// verbatim: nothing is stripped and nothing de-slugs it, so a leading ordinal
// and a dash are both part of the title.

const CONTENT = '---\nlabels: [type:task]\n---\n';

function titleOf(handle: string): string {
  return parseTaskNote(CONTENT, handle).title;
}

describe('NWM-28 — the title is the filename, verbatim', () => {
  it('reads the stem back with no de-slugging', () => {
    expect(titleOf('Projecten/A/taken/fix a to-do twin.md')).toBe(
      'fix a to-do twin',
    );
  });

  it('preserves case', () => {
    expect(titleOf('Projecten/A/taken/Fix the Bug.md')).toBe('Fix the Bug');
  });

  it('keeps a dash as a dash, it does not turn it into a space', () => {
    expect(titleOf('Projecten/A/taken/fix-a-twin.md')).toBe('fix-a-twin');
  });

  it('keeps a leading ordinal verbatim, it does not strip it', () => {
    expect(titleOf('Projecten/A/taken/61-fix-a-to-do-twin.md')).toBe(
      '61-fix-a-to-do-twin',
    );
  });
});
