import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { RegistryPort } from '../../port/RegistryPort.js';

export async function effectiveConnectionTarget(
  registry: RegistryPort,
  projectId: string,
  connection: ConnectionDataTransferObject,
): Promise<string | null> {
  if (connection.target !== '') {
    return connection.target;
  }
  const identity = await registry.getIdentity(projectId, connection.slug);
  const resolved = identity?.target ?? '';
  return resolved !== '' ? resolved : null;
}
