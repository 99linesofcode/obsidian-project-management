export interface SplitFrontmatter {
  fields: Map<string, string>;
  body: string;
}

export function splitFrontmatter(content: string): SplitFrontmatter | null {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return null;
  }
  const fields = new Map<string, string>();
  let i = 1;
  for (; i < lines.length && lines[i] !== '---'; i++) {
    const line = lines[i]!;
    const colon = line.indexOf(':');
    if (colon > 0) {
      fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  if (i >= lines.length) {
    return null;
  }
  return { fields, body: lines.slice(i + 1).join('\n') };
}

export function isCompleted(fields: ReadonlyMap<string, string>): boolean {
  return (fields.get('completed') ?? '') !== '';
}

export function topLevelFrontmatterField(
  content: string,
  key: string,
): string | null {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return null;
  }
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line === '---') {
      return null;
    }
    if (line.startsWith(`${key}:`)) {
      return line.slice(key.length + 1).trim();
    }
  }
  return null;
}

export function hasTopLevelFrontmatterField(
  content: string,
  key: string,
): boolean {
  return topLevelFrontmatterField(content, key) !== null;
}

export function withBody(content: string, body: string): string {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return body;
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    return body;
  }
  return [...lines.slice(0, closing + 1), ...body.split('\n')].join('\n');
}

export function fillFrontmatterFields(
  lines: string[],
  values: Map<string, string>,
): string[] {
  const filled = [...lines];
  const missing: string[] = [];

  for (const key of values.keys()) {
    const index = filled.findIndex((line) => line.startsWith(`${key}:`));
    if (index === -1) {
      missing.push(key);
      continue;
    }
    filled[index] = frontmatterLine(key, values.get(key) ?? '');
  }

  const appended = missing.map((key) =>
    frontmatterLine(key, values.get(key) ?? ''),
  );
  filled.splice(filled.length - 1, 0, ...appended);
  return filled;
}

function frontmatterLine(key: string, value: string): string {
  return value === '' ? `${key}:` : `${key}: ${value}`;
}

export function rewriteFrontmatterFields(
  content: string,
  values: Map<string, string | null>,
  appendMissing = false,
): string {
  const lines = content.split('\n');
  let inFrontmatter = false;
  const removed = new Set<number>();
  let closing = -1;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    if (i === 0 && line === '---') {
      inFrontmatter = true;
      continue;
    }
    if (inFrontmatter && line === '---') {
      closing = i;
      break;
    }
    if (!inFrontmatter) {
      continue;
    }
    for (const [key, value] of values) {
      if (!line.startsWith(`${key}:`)) {
        continue;
      }
      if (value === null) {
        removed.add(i);
      } else {
        lines[i] = `${key}: ${value}`;
      }
      break;
    }
  }

  if (appendMissing && closing !== -1) {
    const missing = [...values.entries()].filter(
      ([key, value]) =>
        value !== null &&
        !lines.some(
          (line, index) =>
            index < closing &&
            !removed.has(index) &&
            line.startsWith(`${key}:`),
        ),
    );
    const appended = missing.map(([key, value]) => `${key}: ${value}`);
    lines.splice(closing, 0, ...appended);
  }

  return lines.filter((_, index) => !removed.has(index)).join('\n');
}

export function replaceTimestampPlaceholders(
  template: string,
  syncedAt: string,
): string {
  return template
    .replaceAll('{{date}}', syncedAt.slice(0, 10))
    .replaceAll('{{time}}', syncedAt.slice(11, 16));
}

export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

export function stemOf(path: string): string {
  const basename = path.split('/').pop() ?? '';
  return basename.replace(/\.md$/, '');
}

const WORK_ITEM_KINDS = new Set([
  'slice',
  'pitch',
  'task',
  'chore',
  'bug',
  'todo',
]);

export function hasTypeLabel(labels: readonly string[]): boolean {
  return typeFromLabels(labels) !== '';
}

export function typeFromLabels(labels: readonly string[]): string {
  for (const label of labels) {
    if (!label.startsWith('type:')) {
      continue;
    }
    const kind = label.slice('type:'.length).trim();
    if (WORK_ITEM_KINDS.has(kind)) {
      return kind;
    }
  }
  return '';
}

export function labelSequence(labels: readonly string[]): string {
  return JSON.stringify([...labels]);
}

export function labelsFromSequence(value: string | null): string[] {
  if (value === null) {
    return [];
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return [];
  }
  return parsedLabelSequence(trimmed) ?? commaSplit(trimmed);
}

function parsedLabelSequence(value: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string')
      : null;
  } catch {
    return null;
  }
}

export function labelsFromNote(content: string): string[] {
  const lines = content.split('\n');
  const closing = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  const end = closing === -1 ? lines.length : closing;
  for (let i = 1; i < end; i++) {
    if (!lines[i]!.startsWith('labels:')) {
      continue;
    }
    const inline = lines[i]!.slice('labels:'.length).trim();
    return inline === ''
      ? blockLabels(lines, i + 1, end)
      : labelsFromSequence(inline);
  }
  return [];
}

function blockLabels(lines: string[], from: number, end: number): string[] {
  const items: string[] = [];
  for (let i = from; i < end; i++) {
    const match = /^\s*-\s*(.*)$/.exec(lines[i]!);
    if (match === null) {
      break;
    }
    items.push(unquote(match[1]!.trim()));
  }
  return items;
}

function unquote(value: string): string {
  return value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

function commaSplit(value: string): string[] {
  return value
    .replace(/^\[/, '')
    .replace(/\]$/, '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item !== '');
}
