import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../../src/Domain/Notes/TaskNoteMapper.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';

const task: TaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the Bug!',
  body: 'The bug happens when the widget is resized.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: [],
};

const context = {
  projectName: 'Acme Widgets',
  syncedAt: '2026-09-18T12:00:00Z',
  statusName: 'Building',
};

describe('TaskNoteMapper', () => {
  it('maps a task to a note path under the project taken folder', () => {
    // Given — a promoted task and its project context

    // When — the note is mapped
    const { path } = TaskNoteMapper.map(task, context);

    // Then — the path carries the project, remote id and title slug
    expect(path).toBe('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
  });

  it('writes the sync frontmatter and the body verbatim', () => {
    // Given — a promoted task and its project context

    // When — the note is mapped
    const { content } = TaskNoteMapper.map(task, context);

    // Then — the frontmatter carries the sync fields and the body is verbatim
    expect(content).toBe(
      [
        '---',
        'categories: [taken]',
        'url: https://github.com/acme/widgets/issues/42',
        'status: Building',
        'affiliation: ["[[Acme Widgets]]"]',
        'synced: 2026-09-18T12:00:00Z',
        '---',
        'The bug happens when the widget is resized.',
      ].join('\n'),
    );
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
    const messy: TaskData = { ...task, title: '  Fix the Bug!!!  ' };

    // When — the note is mapped
    const { path } = TaskNoteMapper.map(messy, context);

    // Then — the slug is lowercased, trimmed and stripped of specials
    expect(path).toBe('Projecten/Acme Widgets/taken/42-fix-the-bug.md');
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
    'url:',
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
        'affiliation: ["[[Acme Widgets]]"]',
        'url: https://github.com/acme/widgets/issues/42',
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
    const stamped = [
      '---',
      'created: {{date}} {{time}}',
      '---',
    ].join('\n');

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
        'url: https://github.com/acme/widgets/issues/42',
        'synced: 2026-09-18T12:00:00Z',
        'affiliation: ["[[Acme Widgets]]"]',
        '---',
        'The bug happens when the widget is resized.',
      ].join('\n'),
    );
  });

  it('falls back to the built-in frontmatter when the template has none', () => {
    // Given — a template without a frontmatter block

    // When — the task is rendered through it
    const { content } = TaskNoteMapper.render('no frontmatter here', task, context);

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
