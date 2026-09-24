export interface ChecklistItem {
  text: string;
  checked: boolean;
  depth: number;
  linkPath?: string;
}

interface ClassifiedLine {
  line: string;
  item: ChecklistItem | null;
}

const CHECKLIST_LINE = /^([ \t]*)- \[([ xX])\](?: (.*))?$/;
const WIKILINK = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/;
const FENCE = /^\s*(`{3,}|~{3,})/;

// Parses a markdown body into its checklist items, in document order. Lines
// inside fenced code blocks and non-checklist lines are not items; the
// renderers below preserve them verbatim.
export function parseChecklist(body: string): ChecklistItem[] {
  return classifyLines(body)
    .map((entry) => entry.item)
    .filter((item): item is ChecklistItem => item !== null);
}

// Re-renders the body, replacing each checklist line with the matching item in
// order. Every other line — including fenced code — is preserved verbatim.
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

// Projects the body for the GitHub issue: checklist lines drop their wikilink
// (GitHub's plain task-list form); every other line is verbatim.
export function toIssueBody(body: string): string {
  return classifyLines(body)
    .map((entry) => (entry.item ? renderUnlinkedItem(entry.item) : entry.line))
    .join('\n');
}

// Re-attaches links after a remote-driven rewrite. Items that already carry a
// link pass through untouched; the rest ask resolve for their note path, and
// stay unlinked when it returns null.
export function withChecklistLinks(
  body: string,
  resolve: (text: string) => string | null,
): string {
  return classifyLines(body)
    .map((entry) => linkItem(entry, resolve))
    .join('\n');
}

function linkItem(
  entry: ClassifiedLine,
  resolve: (text: string) => string | null,
): string {
  const { item } = entry;
  if (item === null || item.linkPath !== undefined) {
    return entry.line;
  }

  const linkPath = resolve(item.text);
  return linkPath === null ? entry.line : renderItem({ ...item, linkPath });
}

// Splits the body into lines, pairing each checklist line with its parsed item.
// Fence state is tracked here so no function below parses fenced content.
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

// A wikilink's display becomes the item text; the path becomes its linkPath.
// Text around the link is kept, with the link replaced by its display.
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

// One level per two columns; a tab counts as two columns.
function indentDepth(indent: string): number {
  let columns = 0;
  for (const char of indent) {
    columns += char === '\t' ? 2 : 1;
  }
  return Math.floor(columns / 2);
}

function renderItem(item: ChecklistItem): string {
  const content =
    item.linkPath === undefined ? item.text : `[[${item.linkPath}|${item.text}]]`;
  return renderLine(item.depth, item.checked, content);
}

function renderUnlinkedItem(item: ChecklistItem): string {
  return renderLine(item.depth, item.checked, item.text);
}

function renderLine(depth: number, checked: boolean, content: string): string {
  const box = checked ? 'x' : ' ';
  return `${'  '.repeat(depth)}- [${box}] ${content}`;
}

function fenceMarker(line: string): string | null {
  const match = line.match(FENCE);
  return match === null ? null : match[1]![0]!;
}
