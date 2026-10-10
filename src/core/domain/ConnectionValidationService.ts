import { isRecord } from './isRecord.js';
import { ConnectionDataTransferObject } from '../application/data/ConnectionDataTransferObject.js';

export interface ConnectionValidationResult {
  connections: readonly ConnectionDataTransferObject[];
  errors: unknown[];
}

export class ConnectionValidationService {
  constructor(private readonly registeredApplications: ReadonlySet<string>) {}

  validate(raw: unknown): ConnectionValidationResult {
    const connections: ConnectionDataTransferObject[] = [];
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
      connections.push(result);
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
    const application = entry.tool;
    if (
      typeof application !== 'string' ||
      !this.registeredApplications.has(application)
    ) {
      return new Error(`connection "${slug}" names an unknown tool`);
    }
    const target = entry.project;
    if (typeof target !== 'string' || target === '') {
      return new Error(`connection "${slug}" must carry a non-empty project`);
    }
    return new ConnectionDataTransferObject({ slug, application, target });
  }
}
