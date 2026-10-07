import { isRecord } from './isRecord.js';
import { isConnectionTool } from './ConnectionTools.js';
import type { ConnectionData } from './ConnectionData.js';

// The validated connections map plus the errors from the entries that were
// dropped, so one broken connection never silences the rest.
export interface ConnectionValidationResult {
  connections: Record<string, ConnectionData>;
  errors: unknown[];
}

// Validates a raw frontmatter `connections` map into the canonical shape. A
// slug must start with a letter or digit and carry only lowercase alphanumerics
// and dashes; a tool must be in the closed adapter registry; a project must be a
// non-empty string. Invalid entries are dropped with a collected error rather
// than thrown. Several connections may name the same tool: the slug is the
// identity, so a project can hold two code-host or two task-manager connections.
export class ConnectionValidator {
  validate(raw: unknown): ConnectionValidationResult {
    const connections: Record<string, ConnectionData> = {};
    const errors: unknown[] = [];
    if (!isRecord(raw)) {
      return { connections, errors };
    }

    for (const [slug, entry] of Object.entries(raw)) {
      const result = this.validateEntry(slug, entry);
      if (result instanceof Error) {
        errors.push(result);
        continue;
      }
      connections[slug] = result;
    }
    return { connections, errors };
  }

  // The validated connection, or the reason the entry is dropped.
  private validateEntry(slug: string, entry: unknown): ConnectionData | Error {
    // A leading dash would render as a YAML list item, and a reserved word
    // would collide with a sibling key, so the first character must be
    // alphanumeric.
    if (!/^[a-z0-9][a-z0-9-]*$/.test(slug)) {
      return new Error(
        `connection slug "${slug}" must start alphanumeric and carry only lowercase alphanumerics and dashes`,
      );
    }
    if (!isRecord(entry)) {
      return new Error(
        `connection "${slug}" must be a map with tool and project`,
      );
    }
    const tool = entry.tool;
    if (typeof tool !== 'string' || !isConnectionTool(tool)) {
      return new Error(`connection "${slug}" names an unknown tool`);
    }
    const project = entry.project;
    if (typeof project !== 'string' || project === '') {
      return new Error(`connection "${slug}" must carry a non-empty project`);
    }
    return { tool, project };
  }
}
