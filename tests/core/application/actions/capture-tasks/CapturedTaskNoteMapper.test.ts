import { describe, expect, it } from 'vitest';
import { CapturedTaskNoteMapper } from '../../../../../src/core/application/actions/capture-tasks/CapturedTaskNoteMapper.js';

const projectName = 'Acme Widgets';
const syncedAt = '2026-09-24T12:00:00Z';

describe('CapturedTaskNoteMapper — a captured task-manager task carries a kind (CAP-2, LBL-7)', () => {
  it('maps a top-level capture to a draft task note carrying type:slice, without a url', () => {
    const note = CapturedTaskNoteMapper.map(
      { title: 'Buy Milk!', projectName, sliceLink: null, kind: 'slice' },
      { syncedAt, statusName: 'Unshaped' },
    );

    expect(note.path).toBe('Projecten/Acme Widgets/taken/buy-milk.md');
    expect(note.content).toContain('categories: [taken]');
    expect(note.content).toContain('labels: [type:slice]');
    expect(note.content).not.toMatch(/^type:/m);
    expect(note.content).toContain('status: Unshaped');
    expect(note.content).toContain('affiliation: ["[[_Acme Widgets]]"]');
    expect(note.content).toContain(`synced: ${syncedAt}`);
    expect(note.content).not.toContain('todoist:');
    expect(note.content).not.toContain('url');
  });

  it('maps a subtask capture to a draft task note carrying type:task (CAP-2, LBL-7)', () => {
    const note = CapturedTaskNoteMapper.map(
      {
        title: 'Write the copy',
        projectName,
        sliceLink: '40-slice-1',
        kind: 'task',
      },
      { syncedAt, statusName: 'Building' },
    );

    expect(note.content).toContain('labels: [type:task]');
    expect(note.content).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[40-slice-1]]"]',
    );
  });

  it('keeps the kind the capture resolved from an explicit type label (CAP-2, LBL-7)', () => {
    const note = CapturedTaskNoteMapper.map(
      { title: 'Fix the bug', projectName, sliceLink: null, kind: 'bug' },
      { syncedAt, statusName: 'Unshaped' },
    );

    expect(note.content).toContain('labels: [type:bug]');
  });
});
