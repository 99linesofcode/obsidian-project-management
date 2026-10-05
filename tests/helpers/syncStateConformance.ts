import { describe, expect, it } from 'vitest';
import type {
  EntityRecord,
  SyncStatePort,
} from '../../src/Domain/Ports/SyncStatePort.js';
import { taskData } from './records.js';

// The port-contract conformance harness. It is deliberately the SAME suite for
// the real SyncStateAdapter and the in-memory FakeSyncState: the fake exists so
// action suites can run without a store, and if the two can disagree, an action
// under test sees behavior the real registry will never have. This is the guard
// that keeps them honest.
export interface SyncStateConformanceHarness {
  // A fresh port over empty state. `pendingProjects` models a store whose
  // projects predate the per-project forced-scan marker (absent = pending).
  create(options?: { pendingProjects?: string[] }): SyncStatePort;
  // Storage/migration capabilities. Present only for the storage-backed
  // adapter; the fake has no persisted container to migrate, so the migration
  // cases are registered only when this is provided.
  migration?: SyncStateMigrationHarness;
}

export interface SyncStateMigrationHarness {
  // Builds a port over a storage seeded with a raw data.json root and exposes
  // the persisted root/container after the adapter has run its migration.
  createFromRoot(raw: Record<string, unknown>): {
    port: SyncStatePort;
    root(): Record<string, unknown>;
    container(): Record<string, unknown>;
  };
}

const PROJECT_A = 'Project A';
const PROJECT_B = 'Project B';
const PATH_A = 'Projecten/Project A/taken/one.md';
const PATH_B = 'Projecten/Project B/taken/two.md';
const PATH_A2 = 'Projecten/Project A/taken/two.md';
const GH = 'https://github.com/acme/repo/issues/1';
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

        // e2 claims the github address e1 holds.
        await port.setMirrorItem(PROJECT_A, 'github', GH, {
          entityId: 'e2',
          base: null,
        });

        expect(await port.getEntity('e1')).not.toBeNull();
        expect((await port.findMirrorItem('github', GH))?.entityId).toBe('e2');
        // e1's OTHER mirror survives the re-point (promise 2).
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
        // The handle index follows the move, so a global lookup still resolves.
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

    describe('fullScanPending per-project semantics', () => {
      it('reads each seeded project as pending', async () => {
        const port = harness.create({ pendingProjects: [PROJECT_A, PROJECT_B] });
        expect(await port.isFullScanPending(PROJECT_A)).toBe(true);
        expect(await port.isFullScanPending(PROJECT_B)).toBe(true);
      });

      it('consumes only the named project, once', async () => {
        const port = harness.create({ pendingProjects: [PROJECT_A, PROJECT_B] });
        expect(await port.consumeFullScan(PROJECT_A)).toBe(true);
        expect(await port.isFullScanPending(PROJECT_A)).toBe(false);
        expect(await port.isFullScanPending(PROJECT_B)).toBe(true);
        expect(await port.consumeFullScan(PROJECT_A)).toBe(false);
      });

      it('reports no pending scan for an unknown project', async () => {
        const port = harness.create();
        expect(await port.isFullScanPending('Missing')).toBe(false);
        expect(await port.consumeFullScan('Missing')).toBe(false);
      });
    });
  });

  if (harness.migration !== undefined) {
    const migration = harness.migration;
    describe(`${label} — migration contract`, () => {
      it('folds a legacy flat root into a version-marked v3 container', async () => {
        const { port, container } = migration.createFromRoot({
          [`status.${GH}`]: {
            url: GH,
            remoteId: 1,
            notePath: PATH_A,
            lastSyncedBodyHash: 'abc123',
            lastSyncedStatus: 'Shipped',
            lastSyncedTitle: 'One',
          },
        });

        const records = await port.listEntities(PROJECT_A);

        expect(records).toHaveLength(1);
        expect(container().version).toBe(3);
        expect(container()[`status.${GH}`]).toBeUndefined();
      });

      it('normalizes a legacy archive node to the canonical shape', async () => {
        const { port, container } = migration.createFromRoot({
          [`archiveBaseline.${PROJECT_A}`]: {
            locationArchived: true,
            closed: true,
          },
          [`archiveBaseline.${PROJECT_B}`]: {
            locationArchived: false,
            closed: false,
          },
        });

        // Any read runs the one-shot migration on first load.
        await port.listEntities(PROJECT_A);

        const projects = container()['projects'] as Record<
          string,
          Record<string, unknown>
        >;
        expect(projects[PROJECT_A]!['archive']).toEqual({
          locationArchived: true,
          closed: true,
          archivedAt: '',
        });
        expect(projects[PROJECT_B]!['archive']).toEqual({
          locationArchived: false,
          closed: false,
          archivedAt: null,
        });
      });

      it('does not re-run the migration chain on an already-current container', async () => {
        const { port, container } = migration.createFromRoot({
          syncState: {
            version: 3,
            projects: {
              [PROJECT_A]: { entities: { e1: { notePath: PATH_A } } },
            },
          },
        });

        expect(await port.getEntity('e1')).not.toBeNull();
        expect(container().version).toBe(3);
        // No v2 `entities` map is stranded at the container root.
        expect(container()['entities']).toBeUndefined();
      });

      it('never re-migrates a newer container and leaves it untouched', async () => {
        const { port, container } = migration.createFromRoot({
          syncState: {
            version: 4,
            projects: {
              [PROJECT_A]: { entities: { e1: { notePath: PATH_A } } },
            },
            futureField: { kept: true },
          },
        });

        expect(await port.getEntity('e1')).not.toBeNull();
        expect(container().version).toBe(4);
        expect(container()['futureField']).toEqual({ kept: true });
        // A newer container is not rewritten at all: no per-project markers.
        expect(container()['projects']).toEqual({
          [PROJECT_A]: { entities: { e1: { notePath: PATH_A } } },
        });
      });

      it('does not strand v2 entities on a current container with stray legacy keys', async () => {
        const { port, container } = migration.createFromRoot({
          syncState: {
            version: 3,
            projects: {
              [PROJECT_A]: { entities: { e1: { notePath: PATH_A } } },
            },
            [`status.${GH}`]: { url: GH, notePath: PATH_A },
          },
        });

        expect(await port.getEntity('e1')).not.toBeNull();
        // migrateEntities never ran, so no v2 `entities` map was created.
        expect(container()['entities']).toBeUndefined();
        expect(container().version).toBe(3);
      });
    });
  }
}
