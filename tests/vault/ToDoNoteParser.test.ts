import { describe, expect, it } from 'vitest';
import { ToDoNoteParser } from '../../src/vault/ToDoNoteParser.js';

describe('TODO-2 — a to-do note parses to the canonical shape', () => {
  it('reads status, completed and affiliation from a to-do note', () => {
    const content = [
      '---',
      'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]',
      'status: completed',
      'completed: 2026-09-18T13:00:00Z',
      '---',
      '',
    ].join('\n');

    const parsed = ToDoNoteParser.parse(content);

    expect(parsed).toEqual({
      status: 'completed',
      completed: '2026-09-18T13:00:00Z',
      affiliation: ['[[Acme Widgets]]', '[[42-fix-the-bug]]'],
    });
  });

  it('reads an empty completed field as null', () => {
    const content = ['---', 'status: open', 'completed:', '---', ''].join('\n');

    const parsed = ToDoNoteParser.parse(content);

    expect(parsed?.completed).toBeNull();
  });

  it('reads the affiliation of a nested to-do', () => {
    const content = [
      '---',
      'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]", "[[9-parent]]"]',
      'status: open',
      '---',
      '',
    ].join('\n');

    const parsed = ToDoNoteParser.parse(content);

    expect(parsed?.affiliation).toEqual([
      '[[Acme Widgets]]',
      '[[42-fix-the-bug]]',
      '[[9-parent]]',
    ]);
  });

  it('returns null for content without frontmatter', () => {
    const parsed = ToDoNoteParser.parse('Just a note.');

    expect(parsed).toBeNull();
  });

  it('returns null for frontmatter without a status field', () => {
    const content = ['---', 'affiliation: ["[[X]]"]', '---', ''].join('\n');

    const parsed = ToDoNoteParser.parse(content);

    expect(parsed).toBeNull();
  });
});
