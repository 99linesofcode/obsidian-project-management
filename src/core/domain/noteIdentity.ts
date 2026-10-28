const CONNECTIONS_LINE = 'connections:';
const VAULT_ENTRY = 'vault:';
const ID_KEY = 'id:';

export function noteId(content: string): string | null {
  const lines = content.split('\n');
  const block = frontmatterBlock(lines);
  if (block === null) {
    return null;
  }

  const connections = block.findIndex((line) => line.trimEnd() === CONNECTIONS_LINE);
  if (connections === -1) {
    return null;
  }

  const connectionsIndent = indentOf(block[connections]!);
  let inVault = false;
  let vaultIndent = -1;

  for (let i = connections + 1; i < block.length; i++) {
    const line = block[i]!;
    if (line.trim() === '') {
      continue;
    }
    const indent = indentOf(line);
    if (indent <= connectionsIndent) {
      break;
    }

    const trimmed = line.trim();
    if (inVault && indent <= vaultIndent) {
      inVault = false;
    }
    if (!inVault) {
      if (trimmed === VAULT_ENTRY) {
        inVault = true;
        vaultIndent = indent;
      }
      continue;
    }
    if (trimmed.startsWith(ID_KEY)) {
      return unquote(trimmed.slice(ID_KEY.length).trim());
    }
  }
  return null;
}

export function stampNoteId(content: string, id: string): string {
  const lines = content.split('\n');
  const block = frontmatterBlock(lines);
  if (block === null) {
    return content;
  }

  const closing = lines.indexOf('---', 1);
  const entry = [`  ${VAULT_ENTRY}`, '    tool: vault', `    id: ${id}`];
  const connections = lines.findIndex(
    (line, index) => index > 0 && index < closing && line.trimEnd() === CONNECTIONS_LINE,
  );

  if (connections === -1) {
    lines.splice(closing, 0, CONNECTIONS_LINE, ...entry);
  } else {
    lines.splice(connections + 1, 0, ...entry);
  }
  return lines.join('\n');
}

function frontmatterBlock(lines: string[]): string[] | null {
  if (lines[0] !== '---') {
    return null;
  }
  const closing = lines.indexOf('---', 1);
  return closing === -1 ? null : lines.slice(1, closing);
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
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
