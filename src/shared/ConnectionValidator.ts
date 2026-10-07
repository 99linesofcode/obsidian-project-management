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
// slug must be lowercase alphanumeric with dashes; a tool must be in the closed
// adapter registry; a project must be a non-empty string. Invalid entries are
// dropped with a collected error rather than thrown. A second connection of the
// same tool is rejected (the first wins) until the registry re-keys to slugs.
export class ConnectionValidator {
  validate(raw: unknown): ConnectionValidationResult {
    const connections: Record<string, ConnectionData> = {};
    const errors: unknown[] = [];
    if (!isRecord(raw)) {
      return { connections, errors };
    }

    const toolsSeen = new Set<string>();
    for (const [slug, entry] of Object.entries(raw)) {
      const result = this.validateEntry(slug, entry, toolsSeen);
      if (result instanceof Error) {
        errors.push(result);
        continue;
      }
      toolsSeen.add(result.tool);
      connections[slug] = result;
    }
    return { connections, errors };
  }

  // The validated connection, or the reason the entry is dropped. A valid
  // entry's tool is recorded by the caller so a later duplicate is rejected.
  private validateEntry(
    slug: string,
    entry: unknown,
    toolsSeen: Set<string>,
  ): ConnectionData | Error {
    if (!/^[a-z0-9-]+$/.test(slug)) {
      return new Error(
        `connection slug "${slug}" must be lowercase alphanumeric with dashes`,
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
    if (toolsSeen.has(tool)) {
      return new Error(
        `connection "${slug}" repeats the "${tool}" tool, which is not supported yet`,
      );
    }
    return { tool, project };
  }
}
