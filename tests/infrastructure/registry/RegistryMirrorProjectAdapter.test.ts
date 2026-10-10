import { describe, expect, it } from 'vitest';
import { RegistryMirrorProjectAdapter } from '../../../src/infrastructure/registry/RegistryMirrorProjectAdapter.js';
import type { PortState } from '../../../src/core/application/data/PortState.js';
import type { ConnectionStatePort } from '../../../src/core/port/ConnectionStatePort.js';

class FakeStore implements ConnectionStatePort {
  private readonly states = new Map<string, PortState>();

  async getPortState(
    project: string,
    connection: string,
  ): Promise<PortState | null> {
    return this.states.get(`${project}\u0000${connection}`) ?? null;
  }

  async setPortState(
    project: string,
    connection: string,
    state: PortState,
  ): Promise<void> {
    this.states.set(`${project}\u0000${connection}`, state);
  }

  async listPortStates(): Promise<Array<{ slug: string; state: PortState }>> {
    return [];
  }

  async rekeyPortState(): Promise<void> {}
}

describe('RegistryMirrorProjectAdapter — the mirror project handle (F02 NWM-2)', () => {
  it('returns null when the connection holds no mirror project', async () => {
    const adapter = new RegistryMirrorProjectAdapter(new FakeStore());

    expect(await adapter.resolve('Acme', 'gh-main')).toBeNull();
  });

  it('treats an empty recorded project as no mirror project', async () => {
    const store = new FakeStore();
    await store.setPortState('Acme', 'gh-main', {
      provider: 'github',
      project: '',
      lastPoll: null,
      lanes: {},
    });
    const adapter = new RegistryMirrorProjectAdapter(store);

    expect(await adapter.resolve('Acme', 'gh-main')).toBeNull();
  });

  it('records the mirror project handle and resolves it back', async () => {
    const adapter = new RegistryMirrorProjectAdapter(new FakeStore());

    await adapter.record(
      'Acme',
      'gh-main',
      'github',
      'https://github.com/acme/widgets',
    );

    expect(await adapter.resolve('Acme', 'gh-main')).toBe(
      'https://github.com/acme/widgets',
    );
  });

  it('preserves the existing port bookkeeping when recording', async () => {
    const store = new FakeStore();
    await store.setPortState('Acme', 'gh-main', {
      provider: 'github',
      project: '',
      lastPoll: '2026-01-01T00:00:00Z',
      lanes: { a: 'x' },
    });
    const adapter = new RegistryMirrorProjectAdapter(store);

    await adapter.record('Acme', 'gh-main', 'github', 'board-1');

    expect(await store.getPortState('Acme', 'gh-main')).toEqual({
      provider: 'github',
      project: 'board-1',
      lastPoll: '2026-01-01T00:00:00Z',
      lanes: { a: 'x' },
    });
  });
});
