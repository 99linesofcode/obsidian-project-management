import type { ConnectionData } from '../shared/ConnectionData.js';
import type { VaultPort } from '../shared/VaultPort.js';
import { parseConnectionsBlock } from '../vault/parseConnectionsBlock.js';
import { projectNameFromPath } from '../vault/projectNameFromPath.js';
import { renderConnectionsBlock } from '../vault/renderConnectionsBlock.js';

// The legacy top-level properties the connection envelope replaces. `pm` and
// `board` contribute no connection (the board is derived from the repo since
// #77; pm is dead); `url` and `todoist` become the github and todoist
// connections.
const LEGACY_PROPERTIES = ['pm', 'url', 'board', 'todoist'] as const;

// UC: migrate a vault's project notes to the connection envelope on load. For
// every project home note under Projecten/ carrying any legacy property, build
// the `connections` map from `url` (github) and `todoist` (todoist), strip all
// four legacy properties, and write both in ONE save. Idempotent: a note with
// no legacy property is untouched, and a note already carrying `connections`
// keeps its entries (only the missing ones are added from the legacy values).
// Silent: a clean migration emits no notice.
export class MigrateProjectConnectionsAction {
  constructor(private readonly vault: VaultPort) {}

  async execute(): Promise<void> {
    for (const path of await this.vault.listNotesInFolder('Projecten')) {
      if (projectNameFromPath(path) === null) {
        continue;
      }
      await this.migrate(path);
    }
  }

  private async migrate(path: string): Promise<void> {
    const note = await this.vault.getNoteByPath(path);
    if (note === null) {
      return;
    }
    const lines = note.content.split('\n');
    if (lines[0] !== '---') {
      return;
    }
    const closing = lines.indexOf('---', 1);
    if (closing === -1) {
      return;
    }

    const frontmatter = lines.slice(1, closing);
    const fields = fieldsOf(frontmatter);
    if (!LEGACY_PROPERTIES.some((key) => fields.has(key))) {
      return;
    }

    const connections = mergeLegacyConnections(
      parseConnectionsBlock(frontmatter),
      fields,
    );
    const kept = stripConnectionsBlock(frontmatter).filter(
      (line) => !isLegacyLine(line),
    );
    const rebuilt = [
      '---',
      ...kept,
      ...renderConnectionsBlock(connections),
      '---',
      ...lines.slice(closing + 1),
    ];
    await this.vault.writeNote(path, rebuilt.join('\n'));
  }
}

// The top-level frontmatter fields, ignoring the indented lines of a nested
// block (so a connection slug named `url` is not mistaken for the legacy
// property).
function fieldsOf(lines: string[]): Map<string, string> {
  const fields = new Map<string, string>();
  for (const line of lines) {
    if (line.startsWith(' ')) {
      continue;
    }
    const colon = line.indexOf(':');
    if (colon > 0) {
      fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  return fields;
}

// The existing connections with the legacy values added for any tool not
// already present, so a partial state is normalized without clobbering a
// user-named connection.
function mergeLegacyConnections(
  existing: Record<string, ConnectionData>,
  fields: Map<string, string>,
): Record<string, ConnectionData> {
  const connections = { ...existing };
  const url = fields.get('url') ?? '';
  if (url !== '' && !hasTool(connections, 'github')) {
    connections.github = { tool: 'github', project: url };
  }
  const todoist = fields.get('todoist') ?? '';
  if (todoist !== '' && !hasTool(connections, 'todoist')) {
    connections.todoist = { tool: 'todoist', project: todoist };
  }
  return connections;
}

function hasTool(
  connections: Record<string, ConnectionData>,
  tool: string,
): boolean {
  return Object.values(connections).some(
    (connection) => connection.tool === tool,
  );
}

// Removes the existing `connections:` block (its key and every indented line)
// so the rebuilt block replaces it rather than duplicating it.
function stripConnectionsBlock(lines: string[]): string[] {
  const kept: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.startsWith('connections:')) {
      inBlock = true;
      continue;
    }
    if (inBlock) {
      if (line.startsWith(' ')) {
        continue;
      }
      inBlock = false;
    }
    kept.push(line);
  }
  return kept;
}

function isLegacyLine(line: string): boolean {
  return LEGACY_PROPERTIES.some((key) => line.startsWith(`${key}:`));
}
