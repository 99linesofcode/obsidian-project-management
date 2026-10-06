import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../src/vault/TaskNoteMapper.js';
import type { TaskNoteSource } from '../../src/vault/TaskNoteMapper.js';

const task: TaskNoteSource = {
  type: 'task',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  createdAt: null,
};

const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'Building',
};

describe('TaskNoteMapper', () => {
  it('maps a task to a slug-named note under the project taken folder', () => {
    // Given — a promoted task and its project context

    // When — the note is mapped
    const { path } = TaskNoteMapper.map(task, context);

    // Then — the path is the title slug; filenames carry no identity
    expect(path).toBe('Projecten/Acme Widgets/taken/fix-the-bug.md');
  });

  it('writes the sync frontmatter and no machine id or url', () => {
    // Given — a promoted task and its project context

    // When — the note is mapped
    const { content } = TaskNoteMapper.map(task, context);

    // Then — the frontmatter carries type and status; no id or url is written
    expect(content).toBe(
      [
        '---',
        'categories: [taken]',
        'type: task',
        'status: Building',
        'affiliation: ["[[_Acme Widgets]]"]',
        'created: 2026-09-18',
        'synced: 2026-09-18T12:00:00Z',
        '---',
        'The bug happens when the widget is resized.',
      ].join('\n'),
    );
    expect(content).not.toContain('url:');
    expect(content).not.toContain('id:');
  });

  it('writes the status name verbatim — the lane the card sits in', () => {
    // Given — a task whose card sits in the done lane
    const shipped = TaskNoteMapper.map(task, {
      ...context,
      statusName: 'Shipped',
    });

    // When — the frontmatter is inspected
    // Then — the status line carries the lane name verbatim
    expect(shipped.content).toContain('status: Shipped');
  });

  it('sanitizes the title into a slug for the filename', () => {
    // Given — a title with characters that do not belong in a filename
    const messy: TaskNoteSource = { ...task, title: '  Fix the Bug!!!  ' };

    // When — the note is mapped
    const { path } = TaskNoteMapper.map(messy, context);

    // Then — the slug is lowercased, trimmed and stripped of specials
    expect(path).toBe('Projecten/Acme Widgets/taken/fix-the-bug.md');
  });

  it('produces the same path for the same task (idempotent)', () => {
    // Given — the same task mapped twice

    // When — both notes are mapped
    const first = TaskNoteMapper.map(task, context);
    const second = TaskNoteMapper.map(task, context);

    // Then — the paths are identical
    expect(second.path).toBe(first.path);
  });
});

describe('TaskNoteMapper.render', () => {
  // The user's template: empty sync fields the plugin fills, vault-owned
  // fields it keeps, and a {{date}} placeholder for the created date.
  const template = [
    '---',
    'affiliation: []',
    'type:',
    'status:',
    'synced:',
    'created: {{date}}',
    'categories:',
    '  - "[[Tasks.base|Tasks]]"',
    'tags: []',
    '---',
  ].join('\n');

  it('renders the template frontmatter, filling the sync fields', () => {
    // Given — a template with empty sync fields and vault-owned fields

    // When — the task is rendered through the template
    const { content } = TaskNoteMapper.render(template, task, context);

    // Then — the sync fields are filled, the vault fields kept, the body appended
    expect(content).toBe(
      [
        '---',
        'affiliation: ["[[_Acme Widgets]]"]',
        'type: task',
        'status: Building',
        'synced: 2026-09-18T12:00:00Z',
        'created: 2026-09-18',
        'categories:',
        '  - "[[Tasks.base|Tasks]]"',
        'tags: []',
        '---',
        'The bug happens when the widget is resized.',
      ].join('\n'),
    );
  });

  it('replaces {{time}} with the sync time', () => {
    // Given — a template that stamps both date and time on a kept field
    const stamped = ['---', 'created: {{date}} {{time}}', '---'].join('\n');

    // When — the task is rendered through the template
    const { content } = TaskNoteMapper.render(stamped, task, context);

    // Then — the placeholder resolves to the sync date and time
    expect(content).toContain('created: 2026-09-18 12:00');
  });

  it('appends sync fields the template does not define', () => {
    // Given — a template that only carries status and created
    const minimal = ['---', 'status:', 'created: {{date}}', '---'].join('\n');

    // When — the task is rendered through the template
    const { content } = TaskNoteMapper.render(minimal, task, context);

    // Then — the missing sync fields are appended to the frontmatter
    expect(content).toBe(
      [
        '---',
        'status: Building',
        'created: 2026-09-18',
        'type: task',
        'affiliation: ["[[_Acme Widgets]]"]',
        'synced: 2026-09-18T12:00:00Z',
        '---',
        'The bug happens when the widget is resized.',
      ].join('\n'),
    );
  });

  it('falls back to the built-in frontmatter when the template has none', () => {
    // Given — a template without a frontmatter block

    // When — the task is rendered through it
    const { content } = TaskNoteMapper.render(
      'no frontmatter here',
      task,
      context,
    );

    // Then — the output equals the built-in mapping
    expect(content).toBe(TaskNoteMapper.map(task, context).content);
  });

  it('falls back to the built-in frontmatter when no template is given', () => {
    // Given — no template (file missing or not configured)

    // When — the task is rendered without one
    const { content } = TaskNoteMapper.render(null, task, context);

    // Then — the output equals the built-in mapping
    expect(content).toBe(TaskNoteMapper.map(task, context).content);
  });
});
