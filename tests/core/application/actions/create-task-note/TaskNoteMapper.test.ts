import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../../../../src/core/application/actions/create-task-note/TaskNoteMapper.js';
import type { TaskNoteSource } from '../../../../../src/core/application/actions/create-task-note/TaskNoteMapper.js';

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

describe('LBL-1 — a task renders as a note carrying labels', () => {
  it('maps a task to a title-named note under the project taken folder', () => {
    expect(TaskNoteMapper.map(task, context).path).toBe(
      'Projecten/Acme Widgets/taken/Fix the Bug!.md',
    );
    expect(() =>
      TaskNoteMapper.map({ ...task, title: '  Fix the Bug!!!  ' }, context),
    ).toThrow();
  });

  it('writes the kind as a labels sequence and no type scalar', () => {
    const { content } = TaskNoteMapper.map(task, context);

    expect(content).toBe(
      [
        '---',
        'categories: [taken]',
        'labels: [type:task]',
        'status: Building',
        'affiliation: ["[[_Acme Widgets]]"]',
        'created: 2026-09-18',
        'synced: 2026-09-18T12:00:00Z',
        '---',
        'The bug happens when the widget is resized.',
      ].join('\n'),
    );
    expect(content).not.toMatch(/^type:/m);
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

describe('TDO-2 — every task note lives under taken/ regardless of kind', () => {
  it('renders a todo kind under taken/ like any other kind', () => {
    for (const type of ['task', 'todo', 'bug']) {
      expect(TaskNoteMapper.map({ ...task, type }, context).path).toBe(
        'Projecten/Acme Widgets/taken/Fix the Bug!.md',
      );
    }
  });
});

describe('TaskNoteMapper.render', () => {
  const template = [
    '---',
    'affiliation: []',
    'labels:',
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
        'labels: [type:task]',
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
    expect(content).not.toMatch(/^type:/m);
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
        'labels: [type:task]',
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
