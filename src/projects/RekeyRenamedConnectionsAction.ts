import type { ConnectionData } from '../core/ConnectionData.js';
import type { ConnectionStatePort } from '../core/ports/ConnectionStatePort.js';

export interface RekeyRenamedConnectionsInput {
  projectName: string;
  connections: Record<string, ConnectionData>;
}

export class RekeyRenamedConnectionsAction {
  constructor(private readonly syncState: ConnectionStatePort) {}

  async execute(input: RekeyRenamedConnectionsInput): Promise<unknown[]> {
    const ports = await this.syncState.listPortStates(input.projectName);
    const matched = new Set<string>();
    const warnings: unknown[] = [];
    for (const [slug, connection] of Object.entries(input.connections)) {
      const existing = ports.find(
        (port) =>
          port.slug !== slug &&
          port.state.provider === connection.tool &&
          port.state.project === connection.project,
      );
      if (existing !== undefined) {
        await this.syncState.rekeyPortState(
          input.projectName,
          existing.slug,
          slug,
        );
        matched.add(existing.slug);
      }
      matched.add(slug);
    }
    for (const port of ports) {
      if (!matched.has(port.slug)) {
        warnings.push(
          new Error(
            `connection "${port.slug}" in project "${input.projectName}" no longer has a matching connection; its sync state is left in place`,
          ),
        );
      }
    }
    return warnings;
  }
}
