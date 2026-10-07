import type { ConnectionData } from '../shared/ConnectionData.js';
import type { SyncStatePort } from '../shared/SyncStatePort.js';

export interface RekeyRenamedConnectionsInput {
  projectName: string;
  connections: Record<string, ConnectionData>;
}

// UC: re-key a renamed connection's registry port in lockstep, so a slug rename
// never disconnects it. A port whose tool + project now lives under a different
// slug is moved to the new slug in one write. A port whose slug disappeared with
// no matching connection is left in place and returned as a warning — connection
// removal is an open design question, so nothing is deleted. Extracted from
// discovery so discovery stays a read.
export class RekeyRenamedConnectionsAction {
  constructor(private readonly syncState: SyncStatePort) {}

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
