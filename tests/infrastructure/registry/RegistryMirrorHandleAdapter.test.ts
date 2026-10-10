import { describe, expect, it } from 'vitest';
import { RegistryMirrorHandleAdapter } from '../../../src/infrastructure/registry/RegistryMirrorHandleAdapter.js';
import type { EntityRecord } from '../../../src/domain/data/EntityRecord.js';
import type { MirrorItem } from '../../../src/domain/data/MirrorItem.js';
import type { TrackedEntityPort } from '../../../src/domain/ports/TrackedEntityPort.js';

class FakeRegistry implements TrackedEntityPort {
  private readonly entities = new Map<string, string>();
  private readonly items = new Map<string, string>();
  readonly setEntities: Array<{ id: string; notePath: string }> = [];
  readonly setItems: Array<{
    project: string;
    connection: string;
    handle: string;
    entityId: string;
  }> = [];
  readonly removedItems: Array<{
    project: string;
    connection: string;
    handle: string;
  }> = [];

  seedEntity(notePath: string, id: string): void {
    this.entities.set(notePath, id);
  }

  seedItem(connection: string, entityId: string, handle: string): void {
    this.items.set(`${connection}\u0000${entityId}`, handle);
  }

  async getEntity(id: string): Promise<EntityRecord | null> {
    for (const [notePath, entityId] of this.entities) {
      if (entityId === id) {
        return { id, notePath };
      }
    }
    return null;
  }

  async findByNotePath(notePath: string): Promise<EntityRecord | null> {
    const id = this.entities.get(notePath);
    return id === undefined ? null : { id, notePath };
  }

  async setEntity(record: EntityRecord): Promise<void> {
    this.entities.set(record.notePath, record.id);
    this.setEntities.push(record);
  }

  async removeEntity(id: string): Promise<void> {
    for (const [notePath, entityId] of this.entities) {
      if (entityId === id) {
        this.entities.delete(notePath);
      }
    }
  }

  async listEntities(): Promise<EntityRecord[]> {
    return [];
  }

  async findMirrorItem(
    connection: string,
    handle: string,
  ): Promise<MirrorItem | null> {
    const prefix = `${connection}\u0000`;
    for (const [key, value] of this.items) {
      if (key.startsWith(prefix) && value === handle) {
        return { entityId: key.slice(prefix.length), base: null };
      }
    }
    return null;
  }

  async findMirrorItemByEntity(
    connection: string,
    entityId: string,
  ): Promise<{ handle: string; item: MirrorItem } | null> {
    const handle = this.items.get(`${connection}\u0000${entityId}`);
    return handle === undefined
      ? null
      : { handle, item: { entityId, base: null } };
  }

  async setMirrorItem(
    project: string,
    connection: string,
    handle: string,
    item: MirrorItem,
  ): Promise<void> {
    this.items.set(`${connection}\u0000${item.entityId}`, handle);
    this.setItems.push({
      project,
      connection,
      handle,
      entityId: item.entityId,
    });
  }

  async removeMirrorItem(
    project: string,
    connection: string,
    handle: string,
  ): Promise<void> {
    for (const [key, value] of this.items) {
      if (value === handle && key.startsWith(`${connection}\u0000`)) {
        this.items.delete(key);
      }
    }
    this.removedItems.push({ project, connection, handle });
  }

  async listMirrorItems(
    _project: string,
    connection: string,
  ): Promise<Array<{ handle: string; item: MirrorItem }>> {
    const prefix = `${connection}\u0000`;
    const listed: Array<{ handle: string; item: MirrorItem }> = [];
    for (const [key, handle] of this.items) {
      if (key.startsWith(prefix)) {
        listed.push({
          handle,
          item: { entityId: key.slice(prefix.length), base: null },
        });
      }
    }
    return listed;
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

    expect(
      await handles.resolve('gh-main', 'Projecten/Acme/taken/fix.md'),
    ).toBe('https://github.com/acme/widgets/issues/42');
    expect(
      await handles.resolve('td-work', 'Projecten/Acme/taken/fix.md'),
    ).toBe('task-9');
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

  it('records a new entity and its mirror item for a note path', async () => {
    const registry = new FakeRegistry();
    const handles = new RegistryMirrorHandleAdapter(registry);

    await handles.record(
      'Acme',
      'gh-main',
      'Projecten/Acme/taken/fix.md',
      'issue-1',
    );

    expect(registry.setEntities).toHaveLength(1);
    expect(registry.setEntities[0]!.notePath).toBe(
      'Projecten/Acme/taken/fix.md',
    );
    expect(registry.setItems).toEqual([
      {
        project: 'Acme',
        connection: 'gh-main',
        handle: 'issue-1',
        entityId: registry.setEntities[0]!.id,
      },
    ]);
    expect(
      await handles.resolve('gh-main', 'Projecten/Acme/taken/fix.md'),
    ).toBe('issue-1');
  });

  it('records a mirror item against an existing entity', async () => {
    const registry = new FakeRegistry();
    registry.seedEntity('Projecten/Acme/taken/fix.md', 'uuid-1');
    const handles = new RegistryMirrorHandleAdapter(registry);

    await handles.record(
      'Acme',
      'gh-main',
      'Projecten/Acme/taken/fix.md',
      'issue-1',
    );

    expect(registry.setEntities).toEqual([]);
    expect(registry.setItems).toEqual([
      {
        project: 'Acme',
        connection: 'gh-main',
        handle: 'issue-1',
        entityId: 'uuid-1',
      },
    ]);
  });

  it('replaces a placeholder handle with the real one', async () => {
    const registry = new FakeRegistry();
    registry.seedEntity('Projecten/Acme/taken/fix.md', 'uuid-1');
    const handles = new RegistryMirrorHandleAdapter(registry);

    await handles.record(
      'Acme',
      'gh-main',
      'Projecten/Acme/taken/fix.md',
      'pendingCreation:Projecten/Acme/taken/fix.md',
    );
    await handles.record(
      'Acme',
      'gh-main',
      'Projecten/Acme/taken/fix.md',
      'issue-1',
    );

    expect(registry.removedItems).toEqual([
      {
        project: 'Acme',
        connection: 'gh-main',
        handle: 'pendingCreation:Projecten/Acme/taken/fix.md',
      },
    ]);
    expect(
      await handles.resolve('gh-main', 'Projecten/Acme/taken/fix.md'),
    ).toBe('issue-1');
  });

  it('lists the handles a connection holds with their note paths', async () => {
    const registry = new FakeRegistry();
    registry.seedEntity('Projecten/Acme/taken/fix.md', 'uuid-1');
    registry.seedEntity('Projecten/Acme/taken/ship.md', 'uuid-2');
    registry.seedItem('gh-main', 'uuid-1', 'issue-1');
    registry.seedItem('gh-main', 'uuid-2', 'issue-2');
    registry.seedItem('td-work', 'uuid-1', 'task-9');
    const handles = new RegistryMirrorHandleAdapter(registry);

    expect(await handles.list('Acme', 'gh-main')).toEqual([
      { handle: 'issue-1', notePath: 'Projecten/Acme/taken/fix.md' },
      { handle: 'issue-2', notePath: 'Projecten/Acme/taken/ship.md' },
    ]);
  });
});
