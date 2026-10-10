import { describe, expect, it } from 'vitest';
import { RegistryMirrorHandleAdapter } from '../../../src/infrastructure/registry/RegistryMirrorHandleAdapter.js';
import type { MirrorItemLookup } from '../../../src/infrastructure/registry/RegistryMirrorHandleAdapter.js';

class FakeRegistry implements MirrorItemLookup {
  private readonly entities = new Map<string, string>();
  private readonly items = new Map<string, string>();

  seedEntity(notePath: string, id: string): void {
    this.entities.set(notePath, id);
  }

  seedItem(connection: string, entityId: string, handle: string): void {
    this.items.set(`${connection}\u0000${entityId}`, handle);
  }

  async findByNotePath(notePath: string): Promise<{ id: string } | null> {
    const id = this.entities.get(notePath);
    return id === undefined ? null : { id };
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
  it('resolves the note path to its entity id and then to that connection handle', async () => {
    const registry = new FakeRegistry();
    registry.seedEntity('Projecten/Acme/taken/fix.md', 'uuid-1');
    registry.seedItem(
      'gh-main',
      'uuid-1',
      'https://github.com/acme/widgets/issues/42',
    );
    registry.seedItem('td-work', 'uuid-1', 'task-9');
    const handles = new RegistryMirrorHandleAdapter(registry);

    expect(await handles.resolve('gh-main', 'Projecten/Acme/taken/fix.md')).toBe(
      'https://github.com/acme/widgets/issues/42',
    );
    expect(await handles.resolve('td-work', 'Projecten/Acme/taken/fix.md')).toBe(
      'task-9',
    );
  });

  it('returns null when the note path maps to no entity', async () => {
    const registry = new FakeRegistry();
    registry.seedItem('gh-main', 'uuid-1', 'handle');
    const handles = new RegistryMirrorHandleAdapter(registry);

    expect(
      await handles.resolve('gh-main', 'Projecten/Acme/taken/missing.md'),
    ).toBeNull();
  });

  it('returns null when the connection holds no item for the entity', async () => {
    const registry = new FakeRegistry();
    registry.seedEntity('Projecten/Acme/taken/fix.md', 'uuid-1');
    const handles = new RegistryMirrorHandleAdapter(registry);

    expect(
      await handles.resolve('gh-main', 'Projecten/Acme/taken/fix.md'),
    ).toBeNull();
  });
});
