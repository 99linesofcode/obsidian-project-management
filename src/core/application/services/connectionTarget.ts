import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { RegistryPort } from '../../port/RegistryPort.js';

// The address a connection's downstream steps use: the resolved addressing's
// effective target when origination recorded one, else the connection's declared
// target. Null when neither exists — the connection has no remote address to
// reach, so the caller skips it rather than addressing an empty target.
export async function effectiveConnectionTarget(
  registry: RegistryPort,
  projectName: string,
  connection: ConnectionDataTransferObject,
): Promise<string | null> {
  const identity = await registry.getIdentity(projectName, connection.slug);
  const resolved = identity?.target ?? '';
  if (resolved !== '') {
    return resolved;
  }
  return connection.target !== '' ? connection.target : null;
}
