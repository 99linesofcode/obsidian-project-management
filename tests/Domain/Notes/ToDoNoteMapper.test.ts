import { describe, expect, it } from 'vitest';
import {
  ToDoNoteMapper,
  type ToDoNoteContext,
  type ToDoNoteInput,
} from '../../../src/Domain/Notes/ToDoNoteMapper.js';
import {
  ToDoNoteParser,
  withToDoStatus,
} from '../../../src/Domain/Notes/ToDoNoteParser.js';

const input: ToDoNoteInput = {
  title: 'Fix the bug',
  projectName: 'Acme Widgets',
  taskLink: '42-fix-the-bug',
};

const context: ToDoNoteContext = {
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'open',
};

describe('ToDoNoteMapper', () => {
  it('maps a to-do to a note path under the project todos folder', () => {
    // Given — a to-do and its project context

    // When — the note is mapped
    const { path } = ToDoNoteMapper.map(input, context);

    // Then — the path carries the project and the title slug
    expect(path).toBe('Projecten/Acme Widgets/todos/fix-the-bug.md');
  });

  it('writes the affiliation, status and empty completed frontmatter', () => {
    // Given — an open to-do and its project context

    // When — the note is mapped
    const { content } = ToDoNoteMapper.map(input, context);

    // Then — the frontmatter carries the managed fields and the body is empty
    expect(content).toBe(
      [
        '---',
        'categories: ["[[Todos.base|Todos]]"]',
        'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]',
        'status: open',
        'completed:',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('carries the Todos base category as the first frontmatter line', () => {
    // Given — an open to-do and its project context

    // When — the note is mapped
    const { content } = ToDoNoteMapper.map(input, context);

    // Then — the built-in fallback lands the note in the Todos base
    expect(content.split('\n')[1]).toBe('categories: ["[[Todos.base|Todos]]"]');
  });

  it('adds the parent to-do to the affiliation when nested', () => {
    // Given — a to-do nested under another to-do
    const nested: ToDoNoteInput = { ...input, parentTodoLink: '9-parent' };

    // When — the note is mapped
    const { content } = ToDoNoteMapper.map(nested, context);

    // Then — the affiliation lists project, task, then parent to-do
    expect(content).toContain(
      'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]", "[[9-parent]]"]',
    );
  });

  it('writes the completion status and timestamp', () => {
    // Given — a completed to-do with a completion stamp

    // When — the note is mapped
    const { content } = ToDoNoteMapper.map(input, {
      ...context,
      statusName: 'completed',
      completedAt: '2026-09-18T13:00:00Z',
    });

    // Then — the status and completed fields carry the completion
    expect(content).toContain('status: completed');
    expect(content).toContain('completed: 2026-09-18T13:00:00Z');
  });

  it('sanitizes the title into a slug for the filename', () => {
    // Given — a title with characters that do not belong in a filename
    const messy: ToDoNoteInput = { ...input, title: '  Fix the Bug!!!  ' };

    // When — the note is mapped
    const { path } = ToDoNoteMapper.map(messy, context);

    // Then — the slug is lowercased, trimmed and stripped of specials
    expect(path).toBe('Projecten/Acme Widgets/todos/fix-the-bug.md');
  });
});

describe('ToDoNoteMapper.render', () => {
  // The user's template: empty managed fields the plugin fills, vault-owned
  // fields it keeps, and a {{date}} placeholder for the created date.
  const template = [
    '---',
    'affiliation: []',
    'status:',
    'completed:',
    'created: {{date}}',
    'tags: []',
    '---',
  ].join('\n');

  it('renders the template frontmatter, filling the managed fields', () => {
    // Given — a template with empty managed fields and vault-owned fields

    // When — the to-do is rendered through the template
    const { content } = ToDoNoteMapper.render(template, input, context);

    // Then — the managed fields are filled, the vault fields kept, body empty
    expect(content).toBe(
      [
        '---',
        'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]',
        'status: open',
        'completed:',
        'created: 2026-09-18',
        'tags: []',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('replaces {{time}} with the sync time', () => {
    // Given — a template that stamps both date and time on a kept field
    const stamped = ['---', 'created: {{date}} {{time}}', '---'].join('\n');

    // When — the to-do is rendered through the template
    const { content } = ToDoNoteMapper.render(stamped, input, context);

    // Then — the placeholder resolves to the sync date and time
    expect(content).toContain('created: 2026-09-18 12:00');
  });

  it('appends managed fields the template does not define', () => {
    // Given — a template that only carries status
    const minimal = ['---', 'status:', '---'].join('\n');

    // When — the to-do is rendered through the template
    const { content } = ToDoNoteMapper.render(minimal, input, context);

    // Then — the missing managed fields are appended to the frontmatter
    expect(content).toBe(
      [
        '---',
        'status: open',
        'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]',
        'completed:',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('falls back to the built-in frontmatter when no template is given', () => {
    // Given — no template (file missing or not configured)

    // When — the to-do is rendered without one
    const { content } = ToDoNoteMapper.render(null, input, context);

    // Then — the output equals the built-in mapping
    expect(content).toBe(ToDoNoteMapper.map(input, context).content);
  });

  it('falls back to the built-in frontmatter when the template has none', () => {
    // Given — a template without a frontmatter block

    // When — the to-do is rendered through it
    const { content } = ToDoNoteMapper.render(
      'no frontmatter here',
      input,
      context,
    );

    // Then — the output equals the built-in mapping
    expect(content).toBe(ToDoNoteMapper.map(input, context).content);
  });

  it('falls back when the template frontmatter is never closed', () => {
    // Given — a template whose frontmatter block is malformed
    const malformed = ['---', 'status:', ''].join('\n');

    // When — the to-do is rendered through it
    const { content } = ToDoNoteMapper.render(malformed, input, context);

    // Then — the output equals the built-in mapping
    expect(content).toBe(ToDoNoteMapper.map(input, context).content);
  });
});

describe('ToDoNoteParser', () => {
  it('round-trips an open to-do back to status, completed and affiliation', () => {
    // Given — a note produced by the mapper
    const { content } = ToDoNoteMapper.map(input, context);

    // When — the note is parsed
    const parsed = ToDoNoteParser.parse(content);

    // Then — status, completed and affiliation are preserved
    expect(parsed).toEqual({
      status: 'open',
      completed: null,
      affiliation: ['[[Acme Widgets]]', '[[42-fix-the-bug]]'],
    });
  });

  it('reads the completion status and timestamp', () => {
    // Given — a completed note with a completion stamp
    const { content } = ToDoNoteMapper.map(input, {
      ...context,
      statusName: 'completed',
      completedAt: '2026-09-18T13:00:00Z',
    });

    // When — the note is parsed
    const parsed = ToDoNoteParser.parse(content);

    // Then — the completion is preserved
    expect(parsed?.status).toBe('completed');
    expect(parsed?.completed).toBe('2026-09-18T13:00:00Z');
  });

  it('reads the affiliation of a nested to-do', () => {
    // Given — a nested to-do note
    const nested: ToDoNoteInput = { ...input, parentTodoLink: '9-parent' };
    const { content } = ToDoNoteMapper.map(nested, context);

    // When — the note is parsed
    const parsed = ToDoNoteParser.parse(content);

    // Then — all three affiliation links are preserved verbatim
    expect(parsed?.affiliation).toEqual([
      '[[Acme Widgets]]',
      '[[42-fix-the-bug]]',
      '[[9-parent]]',
    ]);
  });

  it('returns null for content without frontmatter', () => {
    // Given — a plain note with no frontmatter

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

describe('withToDoStatus', () => {
  const settled = [
    '---',
    'categories: ["[[Todos.base|Todos]]"]',
    'affiliation: ["[[Acme Widgets]]", "[[42-fix-the-bug]]"]',
    'status: open',
    'completed:',
    'tags: []',
    '---',
    'Body stays put.',
  ].join('\n');

  it('rewrites status and completed, preserving the other fields and body', () => {
    // Given — an open to-do note

    // When — it is marked completed with a full ISO stamp
    const updated = withToDoStatus(
      settled,
      'completed',
      '2026-09-18T13:00:00Z',
    );

    // Then — only status and completed change
    const parsed = ToDoNoteParser.parse(updated);
    expect(parsed?.status).toBe('completed');
    expect(parsed?.completed).toBe('2026-09-18T13:00:00Z');
    expect(updated).toContain('tags: []');
    expect(updated).toContain('Body stays put.');
  });

  it('empties the completed stamp when reopening', () => {
    // Given — a completed to-do note
    const completed = withToDoStatus(
      settled,
      'completed',
      '2026-09-18T13:00:00Z',
    );

    // When — it is reopened
    const reopened = withToDoStatus(completed, 'open', null);

    // Then — the status is open and the stamp is cleared
    const parsed = ToDoNoteParser.parse(reopened);
    expect(parsed?.status).toBe('open');
    expect(parsed?.completed).toBeNull();
  });
});
