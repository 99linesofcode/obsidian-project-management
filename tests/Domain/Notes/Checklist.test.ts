import { describe, expect, it, vi } from 'vitest';
import {
  parseChecklist,
  renderChecklist,
  toIssueBody,
  withChecklistLinks,
} from '../../../src/Domain/Notes/Checklist.js';

describe('parseChecklist', () => {
  it('parses flat items in document order with their checked state', () => {
    // Given — a body with unchecked, lower- and upper-case checked items
    const body = ['- [ ] First', '- [x] Second', '- [X] Third'].join('\n');

    // When — the body is parsed
    const items = parseChecklist(body);

    // Then — each item keeps its order, text and checked state
    expect(items).toEqual([
      { text: 'First', checked: false, depth: 0 },
      { text: 'Second', checked: true, depth: 0 },
      { text: 'Third', checked: true, depth: 0 },
    ]);
  });

  it('derives depth from indentation, counting a tab as two spaces', () => {
    // Given — items nested with spaces and a tab
    const body = [
      '- [ ] Top',
      '  - [ ] Two spaces',
      '\t- [ ] One tab',
      '    - [ ] Four spaces',
    ].join('\n');

    // When — the body is parsed
    const depths = parseChecklist(body).map((item) => item.depth);

    // Then — two spaces and one tab are one level, four spaces are two
    expect(depths).toEqual([0, 1, 1, 2]);
  });

  it('extracts the path and display text from a wikilink item', () => {
    // Given — a checklist item whose text is a linked to-do note
    const body = '- [ ] [[Projecten/X/todos/foo|Fix the bug]]';

    // When — the body is parsed
    const items = parseChecklist(body);

    // Then — the display text becomes the item text and the path its linkPath
    expect(items).toEqual([
      {
        text: 'Fix the bug',
        checked: false,
        depth: 0,
        linkPath: 'Projecten/X/todos/foo',
      },
    ]);
  });

  it('uses the path as text when the wikilink has no display part', () => {
    // Given — a checklist item that links without a display part
    const body = '- [ ] [[Projecten/X/todos/foo]]';

    // When — the body is parsed
    const items = parseChecklist(body);

    // Then — the path is both the linkPath and the text
    expect(items).toEqual([
      {
        text: 'Projecten/X/todos/foo',
        checked: false,
        depth: 0,
        linkPath: 'Projecten/X/todos/foo',
      },
    ]);
  });

  it('keeps surrounding text when an item contains a wikilink', () => {
    // Given — a checklist item with a link in the middle of its text
    const body = '- [ ] See [[foo|bar]] now';

    // When — the body is parsed
    const items = parseChecklist(body);

    // Then — the link is replaced by its display, the path kept
    expect(items).toEqual([
      { text: 'See bar now', checked: false, depth: 0, linkPath: 'foo' },
    ]);
  });

  it('never parses checklist-looking lines inside fenced code blocks', () => {
    // Given — checklist lines inside backtick and tilde fences, and one after
    const body = [
      '```',
      '- [ ] In backticks',
      '```',
      '~~~',
      '- [ ] In tildes',
      '~~~',
      '- [ ] Real',
    ].join('\n');

    // When — the body is parsed
    const items = parseChecklist(body);

    // Then — only the line outside every fence is an item
    expect(items).toEqual([{ text: 'Real', checked: false, depth: 0 }]);
  });

  it('ignores empty checkbox items', () => {
    // Given — checkbox lines with no text, and one with text
    const body = ['- [ ]', '- [x]', '- [ ] Real'].join('\n');

    // When — the body is parsed
    const items = parseChecklist(body);

    // Then — only the item with text survives
    expect(items).toEqual([{ text: 'Real', checked: false, depth: 0 }]);
  });

  it('does not treat star or plus markers as checklist lines', () => {
    // Given — star, plus and dash markers
    const body = ['* [ ] Star', '+ [ ] Plus', '- [ ] Dash'].join('\n');

    // When — the body is parsed
    const items = parseChecklist(body);

    // Then — only the dash marker is a checklist item
    expect(items).toEqual([{ text: 'Dash', checked: false, depth: 0 }]);
  });

  it('skips non-checklist lines', () => {
    // Given — prose around a single checklist item
    const body = ['# Heading', 'Some text', '- [ ] Task', 'More text'].join(
      '\n',
    );

    // When — the body is parsed
    const items = parseChecklist(body);

    // Then — only the checklist line is returned
    expect(items).toEqual([{ text: 'Task', checked: false, depth: 0 }]);
  });
});

describe('renderChecklist', () => {
  it('replaces the checklist lines and preserves every other line', () => {
    // Given — a body whose checklist items have been edited
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

    // When — the body is re-rendered
    const rendered = renderChecklist(body, items);

    // Then — only the checklist lines change, in order
    expect(rendered).toBe(
      ['Intro', '- [x] First done', 'Middle', '- [ ] Second', 'Outro'].join(
        '\n',
      ),
    );
  });

  it('round-trips a parsed body back to the same items', () => {
    // Given — a body with plain and linked items
    const body = ['Intro', '- [ ] First', '- [x] [[p|Second]]', 'Outro'].join(
      '\n',
    );

    // When — the parsed items are rendered back
    const items = parseChecklist(body);
    const rendered = renderChecklist(body, items);

    // Then — re-parsing yields the same items
    expect(parseChecklist(rendered)).toEqual(items);
  });

  it('preserves code fences and their checklist-looking lines', () => {
    // Given — a body with a checklist-looking line inside a fence
    const body = ['```', '- [ ] Inside', '```', '- [ ] Outside'].join('\n');
    const items = [{ text: 'Changed', checked: true, depth: 0 }];

    // When — the body is re-rendered with one item
    const rendered = renderChecklist(body, items);

    // Then — the fenced line is untouched and the real item replaced
    expect(rendered).toBe(
      ['```', '- [ ] Inside', '```', '- [x] Changed'].join('\n'),
    );
  });

  it('renders a linked item as a wikilink with its display text', () => {
    // Given — an item carrying a linkPath
    const body = '- [ ] Fix';
    const items = [
      { text: 'Fix', checked: false, depth: 0, linkPath: 'Projecten/X/foo' },
    ];

    // When — the body is re-rendered
    const rendered = renderChecklist(body, items);

    // Then — the line carries the wikilink
    expect(rendered).toBe('- [ ] [[Projecten/X/foo|Fix]]');
  });

  it('renders depth as two spaces per nesting level', () => {
    // Given — items at depth 0 and depth 2
    const body = ['- [ ] Top', '  - [ ] Child'].join('\n');
    const items = [
      { text: 'Top', checked: false, depth: 0 },
      { text: 'Child', checked: false, depth: 2 },
    ];

    // When — the body is re-rendered
    const rendered = renderChecklist(body, items);

    // Then — the child is indented four spaces
    expect(rendered).toBe(['- [ ] Top', '    - [ ] Child'].join('\n'));
  });
});

describe('toIssueBody', () => {
  it('strips wikilinks from checklist lines', () => {
    // Given — a linked and a plain checklist item
    const body = [
      '- [ ] [[Projecten/X/todos/foo|Fix the bug]]',
      '- [x] Plain',
    ].join('\n');

    // When — the body is projected for the issue
    const issue = toIssueBody(body);

    // Then — the checklist keeps its text without the link
    expect(issue).toBe(['- [ ] Fix the bug', '- [x] Plain'].join('\n'));
  });

  it('keeps non-checklist lines and fenced content verbatim', () => {
    // Given — a body with a fenced checklist-looking line and a real linked one
    const body = [
      'Intro',
      '```',
      '- [ ] [[p|Inside]]',
      '```',
      '- [ ] [[p|Outside]]',
    ].join('\n');

    // When — the body is projected for the issue
    const issue = toIssueBody(body);

    // Then — only the real checklist line loses its link
    expect(issue).toBe(
      ['Intro', '```', '- [ ] [[p|Inside]]', '```', '- [ ] Outside'].join(
        '\n',
      ),
    );
  });
});

describe('withChecklistLinks', () => {
  it('attaches a resolved link to every unlinked item', () => {
    // Given — unlinked items and a resolver that slugs their text
    const body = ['- [ ] Fix the bug', '- [x] Done'].join('\n');
    const resolve = (text: string) =>
      `Projecten/X/todos/${text.toLowerCase().replace(/\s+/g, '-')}`;

    // When — the links are re-attached
    const linked = withChecklistLinks(body, resolve);

    // Then — each item carries the resolved wikilink
    expect(linked).toBe(
      [
        '- [ ] [[Projecten/X/todos/fix-the-bug|Fix the bug]]',
        '- [x] [[Projecten/X/todos/done|Done]]',
      ].join('\n'),
    );
  });

  it('leaves an item unlinked when the resolver returns null', () => {
    // Given — an unlinked item and a resolver with nothing to offer
    const body = '- [ ] Fix the bug';

    // When — the links are re-attached
    const linked = withChecklistLinks(body, () => null);

    // Then — the line is unchanged
    expect(linked).toBe(body);
  });

  it('passes items that already carry a link through unchanged', () => {
    // Given — an item that already links and a resolver that would change it
    const body = '- [ ] [[existing|Fix]]';
    const resolve = vi.fn(() => 'new-path');

    // When — the links are re-attached
    const linked = withChecklistLinks(body, resolve);

    // Then — the existing link is kept and the resolver is never asked
    expect(linked).toBe(body);
    expect(resolve).not.toHaveBeenCalled();
  });

  it('preserves non-checklist lines', () => {
    // Given — prose around an unlinked item
    const body = ['Intro', '- [ ] Task', 'Outro'].join('\n');

    // When — the links are re-attached
    const linked = withChecklistLinks(body, () => 'Projecten/X/task');

    // Then — only the checklist line gains a link
    expect(linked).toBe(
      ['Intro', '- [ ] [[Projecten/X/task|Task]]', 'Outro'].join('\n'),
    );
  });
});
