// Splits a note into its YAML frontmatter (as a flat key/value map) and body.
// Returns null when the note has no frontmatter block.
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

// Replaces a note's body, keeping its frontmatter block verbatim. A note with
// no frontmatter block is replaced entirely by the new body.
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

// Fills sync-owned fields into a frontmatter block: a field the block declares
// (even empty) gets its value in place; a missing one is appended before the
// closing delimiter. The values' insertion order is the append order.
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

// An empty value renders as a bare key — the field is present but null.
function frontmatterLine(key: string, value: string): string {
  return value === '' ? `${key}:` : `${key}: ${value}`;
}

// Rewrites the named frontmatter fields in place, preserving the body and every
// other field. A null value renders as a bare key. A field the block does not
// declare is left absent unless appendMissing is set, in which case it is
// appended before the closing delimiter. A note with no frontmatter block is
// returned unchanged.
export function rewriteFrontmatterFields(
  content: string,
  values: Map<string, string | null>,
  appendMissing = false,
): string {
  const lines = content.split('\n');
  let inFrontmatter = false;
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
      if (line.startsWith(`${key}:`)) {
        lines[i] = value === null ? `${key}:` : `${key}: ${value}`;
        break;
      }
    }
  }
  if (appendMissing && closing !== -1) {
    const missing = [...values.keys()].filter(
      (key) =>
        !lines.slice(0, closing).some((line) => line.startsWith(`${key}:`)),
    );
    const appended = missing.map((key) => {
      const value = values.get(key) ?? null;
      return value === null ? `${key}:` : `${key}: ${value}`;
    });
    lines.splice(closing, 0, ...appended);
  }
  return lines.join('\n');
}

// Resolves a template's {{date}}/{{time}} placeholders to the sync stamp.
export function replaceTimestampPlaceholders(
  template: string,
  syncedAt: string,
): string {
  return template
    .replaceAll('{{date}}', syncedAt.slice(0, 10))
    .replaceAll('{{time}}', syncedAt.slice(11, 16));
}

// Sanitises a title into a filename slug: lowercase, spaces to dashes, strip
// everything outside [a-z0-9-], collapse runs of dashes, trim the ends.
//
// WHY this lives in the core: it is a pure string transform the reconciliation
// arithmetic needs (title comparison is slug-based), and the vault module that
// owns note naming must not be a dependency of core.
export function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// A note's filename stem: its basename without the .md extension.
export function stemOf(path: string): string {
  const basename = path.split('/').pop() ?? '';
  return basename.replace(/\.md$/, '');
}

// The comparison stem of a note: its filename stem with a legacy leading
// `<remoteId>-` ordinal prefix stripped and lowercased. Filenames carry zero
// identity weight, so the prefix is presentation, not identity.
export function normalizedStem(path: string): string {
  return stemOf(path).replace(/^\d+-/, '').toLowerCase();
}

const WORK_ITEM_KINDS = new Set(['slice', 'pitch', 'task', 'chore', 'bug', 'todo']);

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
  try {
    const parsed: unknown = JSON.parse(trimmed);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string');
    }
  } catch {
    // The legacy unquoted form is not JSON — fall through to the comma split.
  }
  return commaSplit(trimmed);
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
