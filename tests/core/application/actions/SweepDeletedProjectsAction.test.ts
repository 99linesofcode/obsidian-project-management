import { describe, expect, it } from 'vitest';
import { SweepDeletedProjectsAction } from '../../../../src/core/application/actions/SweepDeletedProjectsAction.js';
import { ProjectLifecycleSyncAction } from '../../../../src/core/application/actions/ProjectLifecycleSyncAction.js';
import { OriginObservation } from '../../../../src/core/domain/OriginObservation.js';
import type { MirrorAdapterFactoryPort } from '../../../../src/core/port/MirrorAdapterFactoryPort.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { FakeVault as FakeVaultBase } from '../../../helpers/fakeVault.js';
import { FakeSyncState } from '../../../helpers/fakeSyncState.js';

const PROJECT = 'Acme';

class ProjectDeletingMirror extends ConformanceMirrorAdapter {
  readonly deletedProjects: string[] = [];
  failDelete = false;

  async deleteProject(target: string): Promise<void> {
    if (this.failDelete) {
      throw new Error('delete failed');
    }
    this.deletedProjects.push(target);
  }
}

class GoneProjectVault extends FakeVaultBase {
  notes: string[] = [];
  observeAbsent = true;

  override async listNotesInFolder(folder: string): Promise<string[]> {
    const prefix = folder.endsWith('/') ? folder : `${folder}/`;
    return this.notes.filter((path) => path.startsWith(prefix));
  }

  override async observeProject(): Promise<OriginObservation> {
    return new OriginObservation({
      current: this.observeAbsent ? null : 'false',
      currentCompleted: false,
      fieldTime: null,
      trustworthy: true,
    });
  }
}

interface HarnessOptions {
  notes?: string[];
  observeAbsent?: boolean;
  failDelete?: boolean;
}

async function harness(options: HarnessOptions = {}) {
  const vault = new GoneProjectVault();
  vault.notes = options.notes ?? [];
  vault.observeAbsent = options.observeAbsent ?? true;

  const registry = new FakeSyncState();
  await registry.recordMirrorProject(PROJECT, 'a', 'conformance', 'board-a');
  await registry.recordMirrorProject(PROJECT, 'b', 'conformance', 'board-b');

  const mirror = new ProjectDeletingMirror();
  mirror.failDelete = options.failDelete ?? false;
  const mirrorAdapters: MirrorAdapterFactoryPort = { create: () => mirror };

  const lifecycle = new ProjectLifecycleSyncAction(
    vault,
    registry,
    mirrorAdapters,
  );
  const action = new SweepDeletedProjectsAction(vault, registry, lifecycle);

  return { action, registry, mirror };
}

describe('SweepDeletedProjectsAction — a gone project is reached from the registry', () => {
  it('removes the remote project on every connection and prunes the record', async () => {
    const { action, registry, mirror } = await harness();

    await action.execute();

    expect(mirror.deletedProjects.sort()).toEqual(['board-a', 'board-b']);
    expect(await registry.listProjects()).not.toContain(PROJECT);
  });

  it('leaves a recorded project whose folder still exists alone', async () => {
    const { action, registry, mirror } = await harness({
      notes: [`Projecten/${PROJECT}/_Acme.md`],
    });

    await action.execute();

    expect(mirror.deletedProjects).toEqual([]);
    expect(await registry.listProjects()).toContain(PROJECT);
  });

  it('never treats a cold metadata cache as an absence', async () => {
    const { action, registry, mirror } = await harness({
      notes: [`Projecten/${PROJECT}/_Acme.md`],
      observeAbsent: true,
    });

    await action.execute();

    expect(mirror.deletedProjects).toEqual([]);
    expect(await registry.listProjects()).toContain(PROJECT);
  });

  it('leaves an archived project alone', async () => {
    const { action, registry, mirror } = await harness({
      notes: [`Archief/${PROJECT}/_Acme.md`],
    });

    await action.execute();

    expect(mirror.deletedProjects).toEqual([]);
    expect(await registry.listProjects()).toContain(PROJECT);
  });

  it('keeps the record when a remote delete fails, so it retries', async () => {
    const { action, registry } = await harness({ failDelete: true });

    await action.execute();

    expect(await registry.listProjects()).toContain(PROJECT);
  });
});
