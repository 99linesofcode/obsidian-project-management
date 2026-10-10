import { describe, expect, it } from 'vitest';
import { RekeyRenamedConnectionsAction } from '../../../../src/core/application/actions/RekeyRenamedConnectionsAction.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

describe('DISC-2 — a renamed connection re-keys its registry port', () => {
  it('moves the port state to the new slug and drops the old key', async () => {
    const syncState = new FakeSyncState();
    await syncState.setPortState('Acme Widgets', 'todoist', {
      provider: 'todoist',
      project: 'P1',
      lastPoll: '2026-09-18T10:00:00Z',
      lanes: { Unshaped: 'S1' },
    });
    const action = new RekeyRenamedConnectionsAction(syncState);

    const warnings = await action.execute({
      projectName: 'Acme Widgets',
      connections: [
        { slug: 'todoist-work', application: 'todoist', target: 'P1' },
      ],
    });

    expect(await syncState.getPortState('Acme Widgets', 'todoist')).toBeNull();
    expect(
      await syncState.getPortState('Acme Widgets', 'todoist-work'),
    ).toEqual({
      provider: 'todoist',
      project: 'P1',
      lastPoll: '2026-09-18T10:00:00Z',
      lanes: { Unshaped: 'S1' },
    });
    expect(warnings).toEqual([]);
  });

  it('leaves a disappeared slug in place and surfaces a warning', async () => {
    const syncState = new FakeSyncState();
    await syncState.setPortState('Acme Widgets', 'todoist-old', {
      provider: 'todoist',
      project: 'P9',
      lastPoll: '2026-09-18T10:00:00Z',
      lanes: {},
    });
    const action = new RekeyRenamedConnectionsAction(syncState);

    const warnings = await action.execute({
      projectName: 'Acme Widgets',
      connections: [
        {
          slug: 'github',
          application: 'github',
          target: 'https://github.com/acme/widgets',
        },
      ],
    });

    expect(
      await syncState.getPortState('Acme Widgets', 'todoist-old'),
    ).not.toBeNull();
    expect(warnings).toHaveLength(1);
  });
});
