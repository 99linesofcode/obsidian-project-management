import { describe, expect, it } from 'vitest';
import { TaskNoteMapper } from '../../../../../src/core/application/actions/create-task-note/TaskNoteMapper.js';
import type { TaskNoteSource } from '../../../../../src/core/application/actions/create-task-note/TaskNoteMapper.js';

// NAME-3 — a plugin-rendered note writes the actual title into `name:`. The
// plugin's own render path resolves only `{{date}}` and `{{time}}`
// (`note.ts`), never `{{title}}` (the core Templates plugin does that on its
// path). So the mapper must fill `name:` itself, on both the built-in
// frontmatter (`map`) and the template path (`render`); otherwise a rendered
// note would carry the literal `name: {{title}}`.
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

describe('NAME-3 — a rendered note carries the actual title, never {{title}}', () => {
  it('writes the title into `name:` on the built-in frontmatter', () => {
    const { content } = TaskNoteMapper.map(task, context);

    expect(content).toContain('name: Fix the Bug!');
    expect(content).not.toContain('{{title}}');
  });

  it('resolves `{{title}}` to the actual title when rendering the template', () => {
    const template = [
      '---',
      'name: {{title}}',
      'status:',
      'created: {{date}}',
      '---',
    ].join('\n');

    const { content } = TaskNoteMapper.render(template, task, context);

    expect(content).toContain('name: Fix the Bug!');
    expect(content).not.toContain('{{title}}');
  });

  it('appends `name:` when the template omits it', () => {
    const template = ['---', 'status:', 'created: {{date}}', '---'].join('\n');

    const { content } = TaskNoteMapper.render(template, task, context);

    expect(content).toContain('name: Fix the Bug!');
  });
});
