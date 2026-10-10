import { describe, expect, it } from 'vitest';
import { CapturedTaskNoteMapper } from '../../../src/infrastructure/vault/CapturedTaskNoteMapper.js';

const projectName = 'Acme Widgets';
const syncedAt = '2026-09-24T12:00:00Z';

describe('MAT-4 — a captured task renders as a note', () => {
  it('maps a top-level capture to a draft task note without a url', () => {
    const note = CapturedTaskNoteMapper.map(
      { title: 'Buy Milk!', projectName, sliceLink: null },
      { syncedAt, statusName: 'Unshaped' },
    );

    expect(note.path).toBe('Projecten/Acme Widgets/taken/buy-milk.md');
    expect(note.content).toContain('categories: [taken]');
    expect(note.content).toContain('status: Unshaped');
    expect(note.content).toContain('affiliation: ["[[_Acme Widgets]]"]');
    expect(note.content).toContain(`synced: ${syncedAt}`);
    expect(note.content).not.toContain('todoist:');
    expect(note.content).not.toContain('url');
  });

  it('affiliates a slice-nested capture to the slice', () => {
    const note = CapturedTaskNoteMapper.map(
      {
        title: 'Write the copy',
        projectName,
        sliceLink: '40-slice-1',
      },
      { syncedAt, statusName: 'Building' },
    );

    expect(note.content).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[40-slice-1]]"]',
    );
  });
});
