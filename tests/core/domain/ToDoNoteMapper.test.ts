import { describe, expect, it } from 'vitest';
import {
  ToDoNoteMapper,
  type ToDoNoteContext,
  type ToDoNoteInput,
} from '../../../src/core/domain/ToDoNoteMapper.js';
import {
  ToDoNoteParser,
  withToDoStatus,
} from '../../../src/core/domain/ToDoNoteParser.js';

const input: ToDoNoteInput = {
  title: 'Fix the bug',
  projectName: 'Acme Widgets',
  taskLink: '42-fix-the-bug',
};

const context: ToDoNoteContext = {
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'open',
};

describe('TODO-1 — a to-do renders as a note', () => {
  it('maps the title to a slug path under the project todos folder', () => {
    expect(ToDoNoteMapper.map(input, context).path).toBe(
      'Projecten/Acme Widgets/todos/fix-the-bug.md',
    );
    expect(
      ToDoNoteMapper.map({ ...input, title: '  Fix the Bug!!!  ' }, context)
        .path,
    ).toBe('Projecten/Acme Widgets/todos/fix-the-bug.md');
  });

  it('writes the Todos base category, affiliation, status and empty completed', () => {
    const { content } = ToDoNoteMapper.map(input, context);

    expect(content).toBe(
      [
        '---',
        'categories: ["[[Todos.base|Todos]]"]',
        'affiliation: ["[[_Acme Widgets]]", "[[42-fix-the-bug]]"]',
        'status: open',
        'completed:',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('adds the parent to-do to the affiliation when nested', () => {
    const nested: ToDoNoteInput = { ...input, parentTodoLink: '9-parent' };

    expect(ToDoNoteMapper.map(nested, context).content).toContain(
      'affiliation: ["[[_Acme Widgets]]", "[[42-fix-the-bug]]", "[[9-parent]]"]',
    );
  });

  it('writes the completion status and timestamp', () => {
    const { content } = ToDoNoteMapper.map(input, {
      ...context,
      statusName: 'completed',
      completedAt: '2026-09-18T13:00:00Z',
    });

    expect(content).toContain('status: completed');
    expect(content).toContain('completed: 2026-09-18T13:00:00Z');
  });
});

describe('TODO-1 — a template is rendered into the to-do', () => {
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
    const { content } = ToDoNoteMapper.render(template, input, context);

    expect(content).toBe(
      [
        '---',
        'affiliation: ["[[_Acme Widgets]]", "[[42-fix-the-bug]]"]',
        'status: open',
        'completed:',
        'created: 2026-09-18',
        'tags: []',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('replaces {{time}} with the sync time and appends missing managed fields', () => {
    const stamped = ['---', 'created: {{date}} {{time}}', '---'].join('\n');
    expect(ToDoNoteMapper.render(stamped, input, context).content).toContain(
      'created: 2026-09-18 12:00',
    );

    const minimal = ['---', 'status:', '---'].join('\n');
    expect(ToDoNoteMapper.render(minimal, input, context).content).toBe(
      [
        '---',
        'status: open',
        'affiliation: ["[[_Acme Widgets]]", "[[42-fix-the-bug]]"]',
        'completed:',
        '---',
        '',
      ].join('\n'),
    );
  });

  it('falls back to the built-in frontmatter when no usable template is given', () => {
    const fallback = ToDoNoteMapper.map(input, context).content;
    for (const bad of [
      null,
      'no frontmatter here',
      ['---', 'status:', ''].join('\n'),
    ]) {
      expect(
        ToDoNoteMapper.render(bad, input, context).content,
        String(bad),
      ).toBe(fallback);
    }
  });
});

describe('TODO-2 — a to-do note parses back to its state', () => {
  it('reads status, completed and affiliation from the rendered note', () => {
    expect(
      ToDoNoteParser.parse(ToDoNoteMapper.map(input, context).content),
    ).toEqual({
      status: 'open',
      completed: null,
      affiliation: ['[[_Acme Widgets]]', '[[42-fix-the-bug]]'],
    });

    const completed = ToDoNoteMapper.map(input, {
      ...context,
      statusName: 'completed',
      completedAt: '2026-09-18T13:00:00Z',
    }).content;
    const parsed = ToDoNoteParser.parse(completed);
    expect(parsed?.status).toBe('completed');
    expect(parsed?.completed).toBe('2026-09-18T13:00:00Z');

    const nested = ToDoNoteMapper.map(
      { ...input, parentTodoLink: '9-parent' },
      context,
    ).content;
    expect(ToDoNoteParser.parse(nested)?.affiliation).toEqual([
      '[[_Acme Widgets]]',
      '[[42-fix-the-bug]]',
      '[[9-parent]]',
    ]);
  });

  it('returns null for content with no frontmatter or no status field', () => {
    for (const content of [
      'Just a note.',
      ['---', 'affiliation: ["[[X]]"]', '---', ''].join('\n'),
    ]) {
      expect(ToDoNoteParser.parse(content), content).toBeNull();
    }
  });
});

describe('TODO-2 — a to-do status is rewritten in place', () => {
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

  it('completes then reopens, preserving the other fields and body', () => {
    const completed = withToDoStatus(
      settled,
      'completed',
      '2026-09-18T13:00:00Z',
    );
    const completedParsed = ToDoNoteParser.parse(completed);
    expect(completedParsed?.status).toBe('completed');
    expect(completedParsed?.completed).toBe('2026-09-18T13:00:00Z');
    expect(completed).toContain('tags: []');
    expect(completed).toContain('Body stays put.');

    const reopened = withToDoStatus(completed, 'open', null);
    const reopenedParsed = ToDoNoteParser.parse(reopened);
    expect(reopenedParsed?.status).toBe('open');
    expect(reopenedParsed?.completed).toBeNull();
  });
});
