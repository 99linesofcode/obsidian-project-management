import type { ConnectionDataTransferObject } from '../data/ConnectionDataTransferObject.js';
import type { ConnectionStatePort } from '../../port/ConnectionStatePort.js';

export interface RekeyRenamedConnectionsInput {
  projectName: string;
  connections: readonly ConnectionDataTransferObject[];
}

export class RekeyRenamedConnectionsAction {
  constructor(private readonly syncState: ConnectionStatePort) {}

  async execute(input: RekeyRenamedConnectionsInput): Promise<unknown[]> {
    const ports = await this.syncState.listPortStates(input.projectName);
    const matched = new Set<string>();
    const warnings: unknown[] = [];
    for (const connection of input.connections) {
      const existing = ports.find(
        (port) =>
          port.slug !== connection.slug &&
          port.state.provider === connection.application &&
          port.state.project === connection.target,
      );
      if (existing !== undefined) {
        await this.syncState.rekeyPortState(
          input.projectName,
          existing.slug,
          connection.slug,
        );
        matched.add(existing.slug);
      }
      matched.add(connection.slug);
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
