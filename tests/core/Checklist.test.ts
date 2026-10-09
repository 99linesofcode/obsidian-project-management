import { describe, expect, it } from 'vitest';
import { parseChecklist, renderChecklist } from '../../src/core/Checklist.js';

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
