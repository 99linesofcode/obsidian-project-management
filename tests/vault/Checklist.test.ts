import { describe, expect, it, vi } from 'vitest';
import {
  parseChecklist,
  renderChecklist,
  toIssueBody,
  withChecklistLinks,
} from '../../src/vault/Checklist.js';
import { slugify } from '../../src/core/TaskNoteMapper.js';

describe('TODO-1 — checklist lines parse to their items', () => {
  it('parses flat items in order with their checked state and indentation depth', () => {
    const flat = ['- [ ] First', '- [x] Second', '- [X] Third'].join('\n');
    expect(parseChecklist(flat)).toEqual([
      { text: 'First', checked: false, depth: 0 },
      { text: 'Second', checked: true, depth: 0 },
      { text: 'Third', checked: true, depth: 0 },
    ]);

    const nested = [
      '- [ ] Top',
      '  - [ ] Two spaces',
      '\t- [ ] One tab',
      '    - [ ] Four spaces',
    ].join('\n');
    expect(parseChecklist(nested).map((item) => item.depth)).toEqual([
      0, 1, 1, 2,
    ]);
  });

  it('extracts the link path and display text from a wikilink item', () => {
    const cases = [
      {
        body: '- [ ] [[Projecten/X/todos/foo|Fix the bug]]',
        item: {
          text: 'Fix the bug',
          checked: false,
          depth: 0,
          linkPath: 'Projecten/X/todos/foo',
        },
      },
      {
        body: '- [ ] [[Projecten/X/todos/foo]]',
        item: {
          text: 'Projecten/X/todos/foo',
          checked: false,
          depth: 0,
          linkPath: 'Projecten/X/todos/foo',
        },
      },
      {
        body: '- [ ] See [[foo|bar]] now',
        item: {
          text: 'See bar now',
          checked: false,
          depth: 0,
          linkPath: 'foo',
        },
      },
    ];
    for (const { body, item } of cases) {
      expect(parseChecklist(body), body).toEqual([item]);
    }
  });

  it('ignores checklist-looking lines it must not treat as items', () => {
    const cases = [
      {
        body: [
          '```',
          '- [ ] In backticks',
          '```',
          '~~~',
          '- [ ] In tildes',
          '~~~',
          '- [ ] Real',
        ].join('\n'),
      },
      { body: ['- [ ]', '- [x]', '- [ ] Real'].join('\n') },
      { body: ['* [ ] Star', '+ [ ] Plus', '- [ ] Dash'].join('\n') },
      {
        body: ['# Heading', 'Some text', '- [ ] Task', 'More text'].join('\n'),
      },
    ];
    for (const { body } of cases) {
      const items = parseChecklist(body);
      expect(items.length, body).toBe(1);
      expect(items[0]!.text, body).not.toMatch(/Star|Plus|In /);
    }
  });
});

describe('TODO-1 — checklist items render back to lines', () => {
  it('replaces the checklist lines and preserves every other line', () => {
    const body = [
      'Intro',
      '- [ ] First',
      'Middle',
      '- [x] Second',
      'Outro',
    ].join('\n');
    const items = [
      { text: 'First done', checked: true, depth: 0 },
      { text: 'Second', checked: false, depth: 0 },
    ];

    expect(renderChecklist(body, items)).toBe(
      ['Intro', '- [x] First done', 'Middle', '- [ ] Second', 'Outro'].join(
        '\n',
      ),
    );
  });

  it('renders a linked item as a wikilink and depth as two spaces per level', () => {
    expect(
      renderChecklist('- [ ] Fix', [
        { text: 'Fix', checked: false, depth: 0, linkPath: 'Projecten/X/foo' },
      ]),
    ).toBe('- [ ] [[Projecten/X/foo|Fix]]');

    expect(
      renderChecklist(['- [ ] Top', '  - [ ] Child'].join('\n'), [
        { text: 'Top', checked: false, depth: 0 },
        { text: 'Child', checked: false, depth: 2 },
      ]),
    ).toBe(['- [ ] Top', '    - [ ] Child'].join('\n'));
  });

  it('round-trips a parsed body back to the same items', () => {
    const body = ['Intro', '- [ ] First', '- [x] [[p|Second]]', 'Outro'].join(
      '\n',
    );
    const items = parseChecklist(body);

    expect(parseChecklist(renderChecklist(body, items))).toEqual(items);
  });

  it('preserves code fences and their checklist-looking lines', () => {
    const body = ['```', '- [ ] Inside', '```', '- [ ] Outside'].join('\n');

    expect(
      renderChecklist(body, [{ text: 'Changed', checked: true, depth: 0 }]),
    ).toBe(['```', '- [ ] Inside', '```', '- [x] Changed'].join('\n'));
  });
});

describe('SYNC-1 — a checklist projects to an issue body', () => {
  it('strips wikilinks from checklist lines and keeps everything else verbatim', () => {
    const body = [
      '- [ ] [[Projecten/X/todos/foo|Fix the bug]]',
      '- [x] Plain',
    ].join('\n');
    expect(toIssueBody(body)).toBe(
      ['- [ ] Fix the bug', '- [x] Plain'].join('\n'),
    );

    const fenced = [
      'Intro',
      '```',
      '- [ ] [[p|Inside]]',
      '```',
      '- [ ] [[p|Outside]]',
    ].join('\n');
    expect(toIssueBody(fenced)).toBe(
      ['Intro', '```', '- [ ] [[p|Inside]]', '```', '- [ ] Outside'].join('\n'),
    );
  });

  it('re-links a projected body back to the original for known to-dos', () => {
    const linked = [
      'Intro',
      '- [ ] [[Projecten/X/todos/fix-the-bug.md|Fix the bug]]',
      '- [x] [[Projecten/X/todos/ship-it.md|Ship it]]',
      'Outro',
    ].join('\n');
    const paths = new Map([
      ['fix-the-bug', 'Projecten/X/todos/fix-the-bug.md'],
      ['ship-it', 'Projecten/X/todos/ship-it.md'],
    ]);
    const resolve = (text: string) => paths.get(slugify(text)) ?? null;

    expect(withChecklistLinks(toIssueBody(linked), resolve)).toBe(linked);
  });
});

describe('TODO-2 — unlinked items gain their resolved link', () => {
  it('attaches a link to every unlinked item and leaves the rest alone', () => {
    const body = ['- [ ] Fix the bug', '- [x] Done'].join('\n');
    const resolve = (text: string) =>
      `Projecten/X/todos/${text.toLowerCase().replace(/\s+/g, '-')}`;

    expect(withChecklistLinks(body, resolve)).toBe(
      [
        '- [ ] [[Projecten/X/todos/fix-the-bug|Fix the bug]]',
        '- [x] [[Projecten/X/todos/done|Done]]',
      ].join('\n'),
    );
  });

  it('leaves an item unlinked when the resolver returns null, preserving other lines', () => {
    const body = ['Intro', '- [ ] Task', 'Outro'].join('\n');
    expect(withChecklistLinks(body, () => null)).toBe(body);
    expect(withChecklistLinks(body, () => 'Projecten/X/task')).toBe(
      ['Intro', '- [ ] [[Projecten/X/task|Task]]', 'Outro'].join('\n'),
    );
  });

  it('passes items that already carry a link through unchanged', () => {
    const body = '- [ ] [[existing|Fix]]';
    const resolve = vi.fn(() => 'new-path');

    expect(withChecklistLinks(body, resolve)).toBe(body);
    expect(resolve).not.toHaveBeenCalled();
  });
});
