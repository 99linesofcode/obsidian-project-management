import { describe, expect, it } from 'vitest';
import { ToDoNoteParser } from '../../../src/Domain/Notes/ToDoNoteParser.js';

describe('ToDoNoteParser', () => {
  it('reads status, completed and affiliation from a to-do note', () => {
    // Given — a completed to-do note with a completion stamp
    const content = [
      '---',
      'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]',
      'status: completed',
      'completed: 2026-09-18T13:00:00Z',
      '---',
      '',
    ].join('\n');

    // When — the note is parsed
    const parsed = ToDoNoteParser.parse(content);

    // Then — the fields are read verbatim
    expect(parsed).toEqual({
      status: 'completed',
      completed: '2026-09-18T13:00:00Z',
      affiliation: ['[[Acme Widgets]]', '[[42-fix-the-bug]]'],
    });
  });

  it('reads an empty completed field as null', () => {
    // Given — an open to-do note with an empty completed field
    const content = ['---', 'status: open', 'completed:', '---', ''].join('\n');

    // When — the note is parsed
    const parsed = ToDoNoteParser.parse(content);

    // Then — the completion stamp is null
    expect(parsed?.completed).toBeNull();
  });

  it('reads the affiliation of a nested to-do', () => {
    // Given — a to-do nested under another to-do
    const content = [
      '---',
      'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]", "[[9-parent]]"]',
      'status: open',
      '---',
      '',
    ].join('\n');

    // When — the note is parsed
    const parsed = ToDoNoteParser.parse(content);

    // Then — all three links are preserved
    expect(parsed?.affiliation).toEqual([
      '[[Acme Widgets]]',
      '[[42-fix-the-bug]]',
      '[[9-parent]]',
    ]);
  });

  it('returns null for content without frontmatter', () => {
    // Given — a plain note

    // When — the note is parsed
    const parsed = ToDoNoteParser.parse('Just a note.');

    // Then — it is not recognised as a to-do note
    expect(parsed).toBeNull();
  });

  it('returns null for frontmatter without a status field', () => {
    // Given — a note with frontmatter but no status
    const content = ['---', 'affiliation: ["[[X]]"]', '---', ''].join('\n');

    // When — the note is parsed
    const parsed = ToDoNoteParser.parse(content);

    // Then — it is not recognised as a to-do note
    expect(parsed).toBeNull();
  });
});
