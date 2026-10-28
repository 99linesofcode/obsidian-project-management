import { describe, expect, it } from 'vitest';
import { parseTaskNote } from '../../../src/infrastructure/vault/taskNoteCodec.js';

// NWM-28 — the canonical title reads the filename. It is the file's stem with a
// leading `NN-` ordinal removed, and otherwise verbatim. Nothing de-slugs it:
// a dash in the filename is a dash in the title.

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

  it('strips a leading ordinal and keeps the rest verbatim', () => {
    expect(titleOf('Projecten/A/taken/61-fix-a-to-do-twin.md')).toBe(
      'fix-a-to-do-twin',
    );
  });
});
