import { isRecord } from './isRecord.js';
import type { ConnectionDataTransferObject } from '../application/data/ConnectionDataTransferObject.js';

export interface ConnectionValidationResult {
  connections: Record<string, ConnectionDataTransferObject>;
  errors: unknown[];
}

export class ConnectionValidator {
  constructor(private readonly registeredApplications: ReadonlySet<string>) {}

  validate(raw: unknown): ConnectionValidationResult {
    const connections: Record<string, ConnectionDataTransferObject> = {};
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

  private validateEntry(
    slug: string,
    entry: unknown,
  ): ConnectionDataTransferObject | Error {
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
    if (typeof tool !== 'string' || !this.registeredApplications.has(tool)) {
      return new Error(`connection "${slug}" names an unknown tool`);
    }
    const project = entry.project;
    if (typeof project !== 'string' || project === '') {
      return new Error(`connection "${slug}" must carry a non-empty project`);
    }
    return { tool, project };
  }
}
