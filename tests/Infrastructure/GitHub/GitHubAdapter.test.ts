import { describe, expect, it } from 'vitest';
import { GitHubAdapter, type Transport } from '../../../src/Infrastructure/GitHub/GitHubAdapter.js';
import type { AttachProjectData } from '../../../src/Domain/DataTransferObjects/AttachProjectData.js';

// A fake transport at the boundary: returns canned responses in call order
// and records the request bodies/paths, so the adapter's mapping is what's
// under test — never a real GitHub call.
function fakeTransport(responses: Array<{ status: number; json: unknown }>) {
  const bodies: string[] = [];
  const paths: string[] = [];
  const transport: Transport = {
    async post(body) {
      bodies.push(body);
      const next = responses.shift();
      if (!next) {
        throw new Error('fake transport: no more responses queued');
      }
      return next;
    },
    async get(path) {
      paths.push(path);
      const next = responses.shift();
      if (!next) {
        throw new Error('fake transport: no more responses queued');
      }
      return next;
    },
  };
  return { transport, bodies, paths };
}

const repoResponse = { status: 200, json: { data: { repository: { id: 'R_kgDOAAAA' } } } };

const userProjectResponse = {
  status: 200,
  json: {
    data: {
      user: {
        projectV2: {
          id: 'PVT_123',
          fields: {
            nodes: [
              { id: 'PVTF_456', name: 'Status', options: [
                { id: 'PVTSSF_1', name: 'Todo' },
                { id: 'PVTSSF_2', name: 'Done' },
              ] },
            ],
          },
        },
      },
    },
  },
};

const orgProjectResponse = {
  status: 200,
  json: {
    data: {
      organization: {
        projectV2: {
          id: 'PVT_789',
          fields: {
            nodes: [
              { id: 'PVTF_101', name: 'Status', options: [
                { id: 'PVTSSF_3', name: 'In progress' },
              ] },
            ],
          },
        },
      },
    },
  },
};

describe('GitHubAdapter', () => {
  it('resolves identities for a user board url', async () => {
    // Given — a user-scoped board and a transport that resolves it
    const { transport, bodies } = fakeTransport([repoResponse, userProjectResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    // When — the adapter resolves the identity
    const result = await adapter.fetchProjectIdentity(data);

    // Then — the DTO carries the resolved identities
    expect(result).toEqual({
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_123',
      statusFieldId: 'PVTF_456',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Todo' },
        { id: 'PVTSSF_2', name: 'Done' },
      ],
    });
    // And the repo query targeted the bound owner/name
    expect(bodies[0]).toContain('repository');
    expect(bodies[0]).toContain('"owner":"acme"');
    expect(bodies[0]).toContain('"name":"widgets"');
    // And the project query targeted the user login and project number
    expect(bodies[1]).toContain('user');
    expect(bodies[1]).toContain('"login":"acme"');
    expect(bodies[1]).toContain('"number":1');
  });

  it('resolves identities for an org board url', async () => {
    // Given — an org-scoped board and a transport that resolves it
    const { transport, bodies } = fakeTransport([repoResponse, orgProjectResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/orgs/acme/projects/2',
    };

    // When — the adapter resolves the identity
    const result = await adapter.fetchProjectIdentity(data);

    // Then — the DTO carries the resolved identities
    expect(result).toEqual({
      repoNodeId: 'R_kgDOAAAA',
      projectNodeId: 'PVT_789',
      statusFieldId: 'PVTF_101',
      statusOptions: [{ id: 'PVTSSF_3', name: 'In progress' }],
    });
    // And the project query targeted the organization login and number
    expect(bodies[1]).toContain('organization');
    expect(bodies[1]).toContain('"login":"acme"');
    expect(bodies[1]).toContain('"number":2');
  });

  it('maps a raw response onto the identity DTO', async () => {
    // Given — a transport returning a raw GraphQL payload
    const { transport } = fakeTransport([repoResponse, userProjectResponse]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    // When — the adapter resolves the identity
    const result = await adapter.fetchProjectIdentity(data);

    // Then — only the fields the core needs are surfaced, in DTO shape
    expect(result).not.toBeNull();
    expect(result!.statusFieldId).toBe('PVTF_456');
    expect(result!.statusOptions).toHaveLength(2);
    expect(result!.statusOptions[0]).toEqual({ id: 'PVTSSF_1', name: 'Todo' });
  });

  it('throws when the project has no Status field', async () => {
    // Given — a project whose fields contain no Status single-select
    const noStatus = {
      status: 200,
      json: {
        data: {
          user: {
            projectV2: {
              id: 'PVT_123',
              fields: { nodes: [{ id: 'PVTF_999', name: 'Priority', options: [] }] },
            },
          },
        },
      },
    };

    // When — the adapter resolves the identity
    const { transport } = fakeTransport([repoResponse, noStatus]);
    const adapter = new GitHubAdapter(transport, 'https://github.com/acme/widgets');
    const data: AttachProjectData = {
      pm: 'github',
      repoUrl: 'https://github.com/acme/widgets',
      boardUrl: 'https://github.com/users/acme/projects/1',
    };

    // Then — it fails with a clear error
    await expect(adapter.fetchProjectIdentity(data)).rejects.toThrow(/Status/);
  });
});
