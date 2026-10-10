import type { ConnectionData } from '../../core/application/data/ConnectionData.js';

export function parseConnectionsBlock(
  frontmatterLines: string[],
): Record<string, ConnectionData> {
  const connections: Record<string, ConnectionData> = {};
  let currentSlug: string | null = null;
  let inBlock = false;
  let slugIndent = -1;

  for (const rawLine of frontmatterLines) {
    const line = rawLine.replace(/\t/g, '  ');
    if (!inBlock) {
      if (line.trimEnd() === 'connections:') {
        inBlock = true;
      }
      continue;
    }
    if (line.trim() === '') {
      continue;
    }
    const indent = line.length - line.trimStart().length;
    if (indent === 0) {
      break;
    }
    const trimmed = line.trim();
    if (slugIndent === -1) {
      slugIndent = indent;
    }
    if (indent <= slugIndent) {
      if (!trimmed.endsWith(':')) {
        continue;
      }
      const slug = unquote(trimmed.slice(0, -1).trim());
      currentSlug = slug;
      connections[slug] = { tool: '', project: '' };
      continue;
    }
    if (currentSlug === null) {
      continue;
    }
    const colon = trimmed.indexOf(':');
    if (colon <= 0) {
      continue;
    }
    const key = trimmed.slice(0, colon).trim();
    const value = unquote(trimmed.slice(colon + 1).trim());
    if (key === 'tool') {
      connections[currentSlug]!.tool = value;
    } else if (key === 'project') {
      connections[currentSlug]!.project = value;
    }
  }
  return connections;
}

function unquote(value: string): string {
  if (value.length < 2) {
    return value;
  }
  const first = value[0];
  const last = value[value.length - 1];
  if ((first === '"' && last === '"') || (first === "'" && last === "'")) {
    return value.slice(1, -1);
  }
  return value;
}
