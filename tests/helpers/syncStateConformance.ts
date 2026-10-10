import { describe, expect, it } from 'vitest';
import type { EntityRecord } from '../../src/core/application/data/EntityRecord.js';
import type { ConnectionStatePort } from '../../src/core/port/ConnectionStatePort.js';
import type { IdentityStorePort } from '../../src/core/port/IdentityStorePort.js';
import type { TrackedEntityPort } from '../../src/core/port/TrackedEntityPort.js';
import { taskData } from './records.js';

export interface SyncStateConformanceHarness {
  create(): IdentityStorePort & TrackedEntityPort & ConnectionStatePort;
}

const PROJECT_A = 'Project A';
const PROJECT_B = 'Project B';
const PATH_A = 'Projecten/Project A/taken/one.md';
const PATH_B = 'Projecten/Project B/taken/two.md';
const PATH_A2 = 'Projecten/Project A/taken/two.md';
const GH = 'https://github.com/acme/repo/issues/1';
const GH2 = 'https://github.com/acme/repo/issues/2';
const PENDING = 'pendingCreation:e1';
const TD = 'T1';

function entity(id: string, notePath: string): EntityRecord {
  return { id, notePath };
}

export function runSyncStateConformance(
  label: string,
  harness: SyncStateConformanceHarness,
): void {
  describe(`${label} — port contract`, () => {
    describe('entity CRUD', () => {
      it('stores and reads back an entity by id', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        expect(await port.getEntity('e1')).toEqual(entity('e1', PATH_A));
      });

      it('returns null for an unknown entity id', async () => {
        const port = harness.create();
        expect(await port.getEntity('missing')).toBeNull();
      });

      it('resolves an entity by its note path', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        expect(await port.findByNotePath(PATH_A)).toEqual(entity('e1', PATH_A));
        expect(
          await port.findByNotePath('Projecten/Project A/taken/none.md'),
        ).toBeNull();
      });

      it('lists only the entities under a project', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setEntity(entity('e2', PATH_B));
        expect((await port.listEntities(PROJECT_A)).map((r) => r.id)).toEqual([
          'e1',
        ]);
        expect((await port.listEntities(PROJECT_B)).map((r) => r.id)).toEqual([
          'e2',
        ]);
        expect(await port.listEntities('Missing')).toEqual([]);
      });

      it('re-keys the path index when an entity is renamed within a project', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setEntity(entity('e1', PATH_A2));
        expect(await port.findByNotePath(PATH_A)).toBeNull();
        expect((await port.findByNotePath(PATH_A2))?.id).toBe('e1');
      });
    });

    describe('notePath uniqueness eviction', () => {
      it('evicts the previous owner and its items when a path is claimed', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setMirrorItem(PROJECT_A, 'github', GH, {
          entityId: 'e1',
          base: taskData({ id: 'e1', notePath: PATH_A }),
        });
        await port.setEntity(entity('e2', PATH_A));
        expect(await port.getEntity('e1')).toBeNull();
        expect((await port.findByNotePath(PATH_A))?.id).toBe('e2');
        expect(await port.findMirrorItem('github', GH)).toBeNull();
      });
    });

    describe('handle collision re-pointing', () => {
      it('re-points a claimed handle without destroying the previous owner', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setEntity(entity('e2', PATH_A2));
        await port.setMirrorItem(PROJECT_A, 'github', GH, {
          entityId: 'e1',
          base: null,
        });
        await port.setMirrorItem(PROJECT_A, 'todoist', TD, {
          entityId: 'e1',
          base: null,
        });

        await port.setMirrorItem(PROJECT_A, 'github', GH, {
          entityId: 'e2',
          base: null,
        });

        expect(await port.getEntity('e1')).not.toBeNull();
        expect((await port.findMirrorItem('github', GH))?.entityId).toBe('e2');
        expect((await port.findMirrorItem('todoist', TD))?.entityId).toBe('e1');
      });

      it('overwrites the base when the same entity re-claims its handle', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setMirrorItem(PROJECT_A, 'github', GH, {
          entityId: 'e1',
          base: taskData({ title: 'old' }),
        });
        await port.setMirrorItem(PROJECT_A, 'github', GH, {
          entityId: 'e1',
          base: taskData({ title: 'new' }),
        });
        expect((await port.findMirrorItem('github', GH))?.base?.title).toBe(
          'new',
        );
      });
    });

    describe('multiple items per entity append ordering', () => {
      it('returns the first-written item from the single-item lookup and lists both', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setMirrorItem(PROJECT_A, 'github', PENDING, {
          entityId: 'e1',
          base: null,
        });
        await port.setMirrorItem(PROJECT_A, 'github', GH2, {
          entityId: 'e1',
          base: taskData({ id: 'e1', notePath: PATH_A }),
        });

        expect(await port.findMirrorItemByEntity('github', 'e1')).toEqual({
          handle: PENDING,
          item: { entityId: 'e1', base: null },
        });
        expect(
          (await port.listMirrorItems(PROJECT_A, 'github')).map(
            ({ handle }) => handle,
          ),
        ).toEqual([PENDING, GH2]);
      });

      it('drops only the named item and keeps the other', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setMirrorItem(PROJECT_A, 'github', PENDING, {
          entityId: 'e1',
          base: null,
        });
        await port.setMirrorItem(PROJECT_A, 'github', GH2, {
          entityId: 'e1',
          base: null,
        });

        await port.removeMirrorItem(PROJECT_A, 'github', PENDING);

        expect(await port.findMirrorItem('github', PENDING)).toBeNull();
        expect(
          (await port.findMirrorItemByEntity('github', 'e1'))?.handle,
        ).toBe(GH2);
      });
    });

    describe('cross-project move item relocation', () => {
      it('relocates an entity and its items when its project changes', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setMirrorItem(PROJECT_A, 'github', GH, {
          entityId: 'e1',
          base: null,
        });

        await port.setEntity(entity('e1', PATH_B));

        expect(await port.listMirrorItems(PROJECT_A, 'github')).toEqual([]);
        expect(await port.listMirrorItems(PROJECT_B, 'github')).toEqual([
          { handle: GH, item: { entityId: 'e1', base: null } },
        ]);
        expect((await port.findMirrorItem('github', GH))?.entityId).toBe('e1');
        expect(await port.listEntities(PROJECT_A)).toEqual([]);
        expect((await port.listEntities(PROJECT_B)).map((r) => r.id)).toEqual([
          'e1',
        ]);
      });
    });

    describe('removeEntity sweep', () => {
      it('removes the record, its path and every mirror item', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setMirrorItem(PROJECT_A, 'github', GH, {
          entityId: 'e1',
          base: null,
        });
        await port.setMirrorItem(PROJECT_A, 'todoist', TD, {
          entityId: 'e1',
          base: null,
        });

        await port.removeEntity('e1');

        expect(await port.getEntity('e1')).toBeNull();
        expect(await port.findByNotePath(PATH_A)).toBeNull();
        expect(await port.findMirrorItem('github', GH)).toBeNull();
        expect(await port.findMirrorItem('todoist', TD)).toBeNull();
      });

      it('leaves another entity and its mirrors untouched', async () => {
        const port = harness.create();
        await port.setEntity(entity('e1', PATH_A));
        await port.setEntity(entity('e2', PATH_A2));
        await port.setMirrorItem(PROJECT_A, 'github', GH, {
          entityId: 'e1',
          base: null,
        });
        await port.setMirrorItem(PROJECT_A, 'todoist', TD, {
          entityId: 'e2',
          base: null,
        });

        await port.removeEntity('e1');

        expect(await port.getEntity('e2')).not.toBeNull();
        expect((await port.findMirrorItem('todoist', TD))?.entityId).toBe('e2');
      });
    });
  });
}
