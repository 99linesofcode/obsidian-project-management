import { describe, expect, it } from 'vitest';
import { CapturedTaskNoteMapper } from '../../../src/Domain/Notes/CapturedTaskNoteMapper.js';

const projectName = 'Acme Widgets';
const syncedAt = '2026-09-24T12:00:00Z';

describe('CapturedTaskNoteMapper', () => {
  it('maps a top-level capture to a draft task note without a url', () => {
    // Given — a Todoist-created top-level task
    // When — it is mapped to a captured note
    const note = CapturedTaskNoteMapper.map(
      { title: 'Buy Milk!', projectName, sliceLink: null, todoistId: 'T1' },
      { syncedAt, statusName: 'Unshaped' },
    );

    // Then — the note is a draft: no url, the todoist anchor is the identity
    expect(note.path).toBe('Projecten/Acme Widgets/taken/buy-milk.md');
    expect(note.content).toContain('categories: [taken]');
    expect(note.content).toContain('status: Unshaped');
    expect(note.content).toContain('affiliation: ["[[Acme Widgets]]"]');
    expect(note.content).toContain(`synced: ${syncedAt}`);
    expect(note.content).toContain('todoist: T1');
    expect(note.content).not.toContain('url');
  });

  it('affiliates a slice-nested capture to the slice', () => {
    // Given — a Todoist task created under a slice
    // When — it is mapped to a captured note
    const note = CapturedTaskNoteMapper.map(
      {
        title: 'Write the copy',
        projectName,
        sliceLink: '40-slice-1',
        todoistId: 'T2',
      },
      { syncedAt, statusName: 'Building' },
    );

    // Then — the affiliation carries the project then the slice
    expect(note.content).toContain(
      'affiliation: ["[[Acme Widgets]]", "[[40-slice-1]]"]',
    );
  });
});
