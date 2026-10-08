import type { CanonicalField } from './canonicalField.js';
import { CanonicalFieldWrite } from './data/CanonicalFieldWrite.js';
import type { CanonicalTask } from './data/CanonicalTask.js';
import type { MergeResult } from './data/MergeResult.js';
import type { MirrorSide } from './data/MirrorSide.js';
import type { MirrorSyncPass } from './data/MirrorSyncPass.js';
import { PassRecord } from './data/PassRecord.js';
import { SideObservation } from './data/SideObservation.js';
import { mergeField } from './mergeField.js';
import type { OriginPort } from './ports/OriginPort.js';

export class MirrorSyncAction {
  constructor(private readonly origin: OriginPort | undefined = undefined) {}

  async invoke(pass: MirrorSyncPass): Promise<PassRecord> {
    const capable = pass.mirrors.filter((mirror) =>
      mirror.adapter.descriptor.represents(pass.field),
    );
    const skipped = pass.mirrors
      .filter((mirror) => !mirror.adapter.descriptor.represents(pass.field))
      .map((mirror) => mirror.side);

    const observations: SideObservation[] = [];
    for (const mirror of capable) {
      observations.push(await observeMirror(mirror, pass));
    }

    const result = mergeField(pass.origin, observations);
    const mirrors = await fanOut(capable, pass, result);
    const originResult = await applyToOrigin(this.origin, pass, result);

    const advanced = [...mirrors.advanced];
    const failed: string[] = [];
    if (originResult.advanced) {
      advanced.push(pass.origin.side);
    }
    if (originResult.failed) {
      failed.push(pass.origin.side);
    }

    return new PassRecord({
      field: pass.field,
      result,
      written: mirrors.written,
      skipped,
      advanced,
      failed,
    });
  }
}

async function observeMirror(
  mirror: MirrorSide,
  pass: MirrorSyncPass,
): Promise<SideObservation> {
  const task = await mirror.adapter.tasks.readTask(mirror.handle);
  const fieldTime = mirror.adapter.timestamps
    ? await mirror.adapter.timestamps.fieldTime(mirror.handle, pass.field)
    : null;

  return new SideObservation({
    side: mirror.side,
    role: 'mirror',
    current: task === null ? null : canonicalValue(task, pass.field),
    baseline: pass.baselines.get(mirror.side) ?? null,
    fieldTime,
    timestampTrustworthy: mirror.adapter.descriptor.capabilities.includes(
      'trustworthy per-field timestamps',
    ),
    completeFetch: mirror.adapter.completeFetch
      ? mirror.adapter.completeFetch.fetchComplete()
      : false,
    currentCompleted: task === null ? false : task.completed,
  });
}

async function fanOut(
  capable: readonly MirrorSide[],
  pass: MirrorSyncPass,
  result: MergeResult,
): Promise<{ written: string[]; advanced: string[] }> {
  const written: string[] = [];
  const advanced: string[] = [];

  if (result.outcome === 'value') {
    for (const mirror of capable) {
      const task = await mirror.adapter.tasks.readTask(mirror.handle);
      if (task !== null && canonicalValue(task, pass.field) === result.value) {
        advanced.push(mirror.side);
        continue;
      }
      await mirror.adapter.tasks.applyField(
        new CanonicalFieldWrite({
          handle: mirror.handle,
          field: pass.field,
          value: result.value,
        }),
      );
      written.push(mirror.side);
      advanced.push(mirror.side);
    }
  } else if (result.outcome === 'delete') {
    for (const mirror of capable) {
      const task = await mirror.adapter.tasks.readTask(mirror.handle);
      if (task === null) {
        advanced.push(mirror.side);
        continue;
      }
      await mirror.adapter.tasks.deleteTask(mirror.handle);
      written.push(mirror.side);
      advanced.push(mirror.side);
    }
  }

  return { written, advanced };
}

async function applyToOrigin(
  origin: OriginPort | undefined,
  pass: MirrorSyncPass,
  result: MergeResult,
): Promise<{ advanced: boolean; failed: boolean }> {
  if (origin === undefined || result.outcome === 'unchanged') {
    return { advanced: false, failed: false };
  }

  if (result.outcome === 'value') {
    if (pass.origin.current === result.value) {
      return { advanced: true, failed: false };
    }
    try {
      await origin.applyField(
        new CanonicalFieldWrite({
          handle: pass.entityId,
          field: pass.field,
          value: result.value,
        }),
      );
      return { advanced: true, failed: false };
    } catch {
      return { advanced: false, failed: true };
    }
  }

  if (pass.origin.current === null) {
    return { advanced: true, failed: false };
  }
  try {
    await origin.trash(pass.entityId);
    return { advanced: true, failed: false };
  } catch {
    return { advanced: false, failed: true };
  }
}

function canonicalValue(
  task: CanonicalTask,
  field: CanonicalField,
): string | null {
  switch (field) {
    case 'title':
      return task.title;
    case 'body':
      return task.body;
    case 'Status':
      return task.status;
    case 'completion':
      return task.completed ? 'true' : 'false';
    case 'subtasks':
      return task.parent;
    case 'label':
      return task.labels.join(',');
    case 'identity':
      return task.entityId;
  }
}
