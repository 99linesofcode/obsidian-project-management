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

describe('MAT-5 — a task renders as a note', () => {
  it('maps a task to a slug-named note under the project taken folder', () => {
    expect(TaskNoteMapper.map(task, context).path).toBe(
      'Projecten/Acme Widgets/taken/fix-the-bug.md',
    );
    expect(
      TaskNoteMapper.map({ ...task, title: '  Fix the Bug!!!  ' }, context)
        .path,
    ).toBe('Projecten/Acme Widgets/taken/fix-the-bug.md');
  });

  it('writes the sync frontmatter and no machine id or url', () => {
    const { content } = TaskNoteMapper.map(task, context);

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
    const shipped = TaskNoteMapper.map(task, {
      ...context,
      statusName: 'Shipped',
    });

    expect(shipped.content).toContain('status: Shipped');
  });

  it('produces the same path for the same task (idempotent)', () => {
    const first = TaskNoteMapper.map(task, context);
    const second = TaskNoteMapper.map(task, context);

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
    const { content } = TaskNoteMapper.render(template, task, context);

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
    const stamped = ['---', 'created: {{date}} {{time}}', '---'].join('\n');

    const { content } = TaskNoteMapper.render(stamped, task, context);

    expect(content).toContain('created: 2026-09-18 12:00');
  });

  it('appends sync fields the template does not define', () => {
    const minimal = ['---', 'status:', 'created: {{date}}', '---'].join('\n');

    const { content } = TaskNoteMapper.render(minimal, task, context);

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

  it('falls back to the built-in frontmatter when the template is unusable', () => {
    const fallback = TaskNoteMapper.map(task, context).content;
    for (const template of [null, 'no frontmatter here']) {
      expect(
        TaskNoteMapper.render(template, task, context).content,
        String(template),
      ).toBe(fallback);
    }
  });
});
