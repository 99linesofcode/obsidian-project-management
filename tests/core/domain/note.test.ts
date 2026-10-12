import { describe, expect, it } from 'vitest';
import {
  splitFrontmatter,
  stemOf,
  typeFromLabels,
  withBody,
} from '../../../src/core/domain/note.js';

describe('DISC-2 — frontmatter is split from the body', () => {
  it('splits the fields from the body', () => {
    const content = [
      '---',
      'url: https://example.com/1',
      'status: open',
      '---',
      'Body line.',
    ].join('\n');

    const split = splitFrontmatter(content);

    expect(split?.fields.get('url')).toBe('https://example.com/1');
    expect(split?.fields.get('status')).toBe('open');
    expect(split?.body).toBe('Body line.');
  });

  it('keeps a colon inside a value', () => {
    const content = ['---', 'url: https://example.com/1', '---', ''].join('\n');

    const split = splitFrontmatter(content);

    expect(split?.fields.get('url')).toBe('https://example.com/1');
  });

  it('returns null when there is no frontmatter block', () => {
    const split = splitFrontmatter('Just a note.');

    expect(split).toBeNull();
  });

  it('returns null when the frontmatter is never closed', () => {
    const content = ['---', 'status: open', ''].join('\n');

    const split = splitFrontmatter(content);

    expect(split).toBeNull();
  });
});

describe('DISC-2 — a note body is replaced in place', () => {
  it('replaces the body and keeps the frontmatter verbatim', () => {
    const content = ['---', 'status: open', '---', 'Old body'].join('\n');

    const updated = withBody(content, 'New body');

    expect(updated).toBe(['---', 'status: open', '---', 'New body'].join('\n'));
  });

  it('replaces the whole note when it has no frontmatter', () => {
    const updated = withBody('Just prose.', 'New body');

    expect(updated).toBe('New body');
  });

  it('replaces the whole note when the frontmatter is never closed', () => {
    const updated = withBody(['---', 'status: open'].join('\n'), 'New body');

    expect(updated).toBe('New body');
  });
});

describe('REN-1 — a note stem survives a rename', () => {
  it('returns the basename without the .md extension', () => {
    const stem = stemOf('Projecten/Acme Widgets/taken/42-fix-the-bug.md');

    expect(stem).toBe('42-fix-the-bug');
  });

  it('returns a bare filename unchanged', () => {
    const stem = stemOf('note.md');

    expect(stem).toBe('note');
  });
});

describe('LBL-2 — the kind resolves from the closed vocabulary', () => {
  it('reads the kind from a spaced type label, trimming the remainder', () => {
    expect(typeFromLabels(['type: task', 'bug'])).toBe('task');
  });

  it('reads the kind from a legacy no-space type label', () => {
    expect(typeFromLabels(['type:bug'])).toBe('bug');
  });

  it('takes the first type label when several are present', () => {
    expect(typeFromLabels(['type:task', 'type:bug'])).toBe('task');
  });

  it('returns empty when no type label is present', () => {
    expect(typeFromLabels(['bug', 'chore'])).toBe('');
  });

  it('never mistakes an arbitrary non-type label for the kind', () => {
    expect(typeFromLabels(['priority:high'])).toBe('');
  });

  it.each(['type:unknown', 'type:sliceish', 'type:pitchfork'])(
    'rejects the unknown kind %s',
    (label) => {
      expect(typeFromLabels([label])).toBe('');
    },
  );

  it.each(['Type:task', 'TYPE:bug'])(
    'rejects the differently-cased prefix %s',
    (label) => {
      expect(typeFromLabels([label])).toBe('');
    },
  );

  it('rejects a type label with an empty remainder', () => {
    expect(typeFromLabels(['type:'])).toBe('');
    expect(typeFromLabels(['type:   '])).toBe('');
  });
});

describe('LBL-9 — a ToDo is type:todo, never a todo: label', () => {
  it('resolves the todo kind from its type label', () => {
    expect(typeFromLabels(['type:todo'])).toBe('todo');
  });

  it('does not treat a bare todo as a type label', () => {
    expect(typeFromLabels(['todo'])).toBe('');
  });

  it('does not treat a todo: label as a type label', () => {
    expect(typeFromLabels(['todo:true'])).toBe('');
  });
});
