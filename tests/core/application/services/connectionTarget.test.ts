import { describe, expect, it } from 'vitest';
import { effectiveConnectionTarget } from '../../../../src/core/application/services/connectionTarget.js';
import { ConnectionDataTransferObject } from '../../../../src/core/port/data/ConnectionDataTransferObject.js';
import { ProjectIdentityDataTransferObject } from '../../../../src/core/port/data/ProjectIdentityDataTransferObject.js';
import type { RegistryPort } from '../../../../src/core/port/RegistryPort.js';

const PROJECT = 'Acme';

function registryWithIdentity(
  identity: ProjectIdentityDataTransferObject,
): RegistryPort {
  return {
    getIdentity: async () => identity,
  } as unknown as RegistryPort;
}

describe('effectiveConnectionTarget — a non-empty declared target wins over the recorded identity (ORG-2)', () => {
  it('addresses by the declared target when it is non-empty and the recorded identity differs (ORG-2)', async () => {
    const connection = new ConnectionDataTransferObject({
      slug: 'a',
      application: 'conformance',
      target: 'declared-board',
    });
    const registry = registryWithIdentity(
      new ProjectIdentityDataTransferObject({
        target: 'recorded-board',
        targetHandle: '',
        projectHandle: 'PVT_1',
        statusFieldHandle: '',
        statusOptions: [],
      }),
    );

    const effective = await effectiveConnectionTarget(
      registry,
      PROJECT,
      connection,
    );

    expect(effective).toBe('declared-board');
  });
});
