import { describe, expect, it } from 'vitest';
import { CapturedTaskNoteMapper } from '../../../../../src/core/application/actions/capture-tasks/CapturedTaskNoteMapper.js';

// FN-1 — a captured task-manager task's draft note renders its filename from
// the title verbatim. MAT-5 — the note shape carries no `name:`.

const projectName = 'Acme Widgets';
const syncedAt = '2026-09-24T12:00:00Z';

function map(title: string) {
  return CapturedTaskNoteMapper.map(
    { title, projectName, sliceLink: null, kind: 'slice' },
    { syncedAt, statusName: 'Unshaped' },
  );
}

describe('FN-1 — a captured task draft renders its filename from the title', () => {
  it('renders a colon as a space and preserves case', () => {
    expect(map('Fix: the Bug').path).toBe(
      'Projecten/Acme Widgets/taken/Fix the Bug.md',
    );
  });

  it('collapses whitespace and introduces no dashes', () => {
    expect(map('Fix  the  Bug').path).toBe(
      'Projecten/Acme Widgets/taken/Fix the Bug.md',
    );
  });
});

describe('MAT-5 — a captured task draft carries no name: field', () => {
  it('writes no name: line', () => {
    expect(map('Fix the Bug').content).not.toMatch(/^name:/m);
  });
});
