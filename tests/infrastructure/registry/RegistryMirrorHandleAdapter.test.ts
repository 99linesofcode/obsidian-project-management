import { describe, expect, it } from 'vitest';
import { RegistryMirrorHandleAdapter } from '../../../src/infrastructure/registry/RegistryMirrorHandleAdapter.js';
import type { MirrorItemLookup } from '../../../src/infrastructure/registry/RegistryMirrorHandleAdapter.js';

class FakeRegistry implements MirrorItemLookup {
  private readonly items = new Map<string, string>();

  seed(connection: string, entityId: string, handle: string): void {
    this.items.set(`${connection}\u0000${entityId}`, handle);
  }

  async findMirrorItemByEntity(
    connection: string,
    entityId: string,
  ): Promise<{ handle: string } | null> {
    const handle = this.items.get(`${connection}\u0000${entityId}`);
    return handle === undefined ? null : { handle };
  }
}

describe('RegistryMirrorHandleAdapter — entity to per-connection handle (F02 NWM-2)', () => {
  it("returns the handle the registry maps to the entity for that connection", async () => {
    const registry = new FakeRegistry();
    registry.seed('gh-main', 'uuid-1', 'https://github.com/acme/widgets/issues/42');
    registry.seed('td-work', 'uuid-1', 'task-9');
    const handles = new RegistryMirrorHandleAdapter(registry);

    expect(await handles.resolve('gh-main', 'uuid-1')).toBe(
      'https://github.com/acme/widgets/issues/42',
    );
    expect(await handles.resolve('td-work', 'uuid-1')).toBe('task-9');
  });

  it('returns null when the connection holds no item for the entity', async () => {
    const handles = new RegistryMirrorHandleAdapter(new FakeRegistry());

    expect(await handles.resolve('gh-main', 'uuid-1')).toBeNull();
  });
});
