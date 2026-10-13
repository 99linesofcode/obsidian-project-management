import type { ConnectionDataTransferObject } from '../../port/data/ConnectionDataTransferObject.js';
import type { RegistryPort } from '../../port/RegistryPort.js';

// The address a connection's downstream steps use: the declared target when the
// connection declares one (ORG-2: a non-empty target overrides), else the
// resolved addressing's effective target origination recorded for the empty
// target. Null when neither exists — the connection has no remote address to
// reach, so the caller skips it rather than addressing an empty target.
export async function effectiveConnectionTarget(
  registry: RegistryPort,
  projectName: string,
  connection: ConnectionDataTransferObject,
): Promise<string | null> {
  if (connection.target !== '') {
    return connection.target;
  }
  const identity = await registry.getIdentity(projectName, connection.slug);
  const resolved = identity?.target ?? '';
  return resolved !== '' ? resolved : null;
}
