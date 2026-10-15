import type { ChecklistItem } from './ChecklistItem.js';

interface ClassifiedLine {
  line: string;
  item: ChecklistItem | null;
}

const CHECKLIST_LINE = /^([ \t]*)- \[([ xX])\](?: (.*))?$/;
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;
const FENCE = /^\s*(`{3,}|~{3,})/;

export function parseChecklist(body: string): ChecklistItem[] {
  return classifyLines(body)
    .map((entry) => entry.item)
    .filter((item): item is ChecklistItem => item !== null);
}

export function renderChecklist(body: string, items: ChecklistItem[]): string {
  const out: string[] = [];
  let index = 0;

  for (const entry of classifyLines(body)) {
    if (entry.item === null) {
      out.push(entry.line);
      continue;
    }
    const item = items[index];
    index++;
    out.push(item === undefined ? entry.line : renderItem(item));
  }

  return [...out, ...items.slice(index).map(renderItem)].join('\n');
}

function classifyLines(body: string): ClassifiedLine[] {
  const classified: ClassifiedLine[] = [];
  let fence: string | null = null;

  for (const line of body.split('\n')) {
    const marker = fenceMarker(line);
    if (fence !== null) {
      if (marker === fence) {
        fence = null;
      }
      classified.push({ line, item: null });
      continue;
    }
    if (marker !== null) {
      fence = marker;
      classified.push({ line, item: null });
      continue;
    }
    classified.push({ line, item: parseChecklistLine(line) });
  }

  return classified;
}

function parseChecklistLine(line: string): ChecklistItem | null {
  const match = line.match(CHECKLIST_LINE);
  if (!match) {
    return null;
  }

  const text = match[3] ?? '';
  if (text.trim() === '') {
    return null;
  }

  const link = extractWikilink(text);
  const item: ChecklistItem = {
    text: link === null ? text : link.text,
    checked: match[2] !== ' ',
    depth: indentDepth(match[1]!),
  };
  if (link !== null) {
    item.linkPath = link.linkPath;
  }
  return item;
}

function extractWikilink(
  text: string,
): { text: string; linkPath: string } | null {
  const match = text.match(WIKILINK);
  if (!match) {
    return null;
  }

  const linkPath = match[1]!;
  const display = match[2] ?? linkPath;
  const index = match.index ?? 0;
  const stripped =
    text.slice(0, index) + display + text.slice(index + match[0].length);
  return { text: stripped, linkPath };
}

function indentDepth(indent: string): number {
  let columns = 0;
  for (const char of indent) {
    columns += char === '\t' ? 2 : 1;
  }
  return Math.floor(columns / 2);
}

function renderItem(item: ChecklistItem): string {
  const content =
    item.linkPath === undefined
      ? item.text
      : `[[${item.linkPath}|${item.text}]]`;
  return renderLine(item.depth, item.checked, content);
}

function renderLine(depth: number, checked: boolean, content: string): string {
  const box = checked ? 'x' : ' ';
  return `${'  '.repeat(depth)}- [${box}] ${content}`;
}

function fenceMarker(line: string): string | null {
  const match = line.match(FENCE);
  return match === null ? null : match[1]![0]!;
}
