import type { CanonicalField } from './canonicalField.js';
import { CanonicalFieldWrite } from './data/CanonicalFieldWrite.js';
import type { CanonicalTask } from './data/CanonicalTask.js';
import type { MergeResult } from './data/MergeResult.js';
import type { MirrorSyncPass } from './data/MirrorSyncPass.js';
import { PassRecord } from './data/PassRecord.js';
import type { RegisteredAdapter } from './data/RegisteredAdapter.js';
import { SideObservation } from './data/SideObservation.js';
import { mergeField } from './mergeField.js';

export class MirrorSyncAction {
  async invoke(pass: MirrorSyncPass): Promise<PassRecord> {
    const capable = pass.mirrors.filter((mirror) =>
      mirror.descriptor.represents(pass.field),
    );
    const skipped = pass.mirrors
      .filter((mirror) => !mirror.descriptor.represents(pass.field))
      .map((mirror) => mirror.descriptor.applicationId);

    const observations: SideObservation[] = [];
    for (const mirror of capable) {
      observations.push(await observeMirror(mirror, pass));
    }

    const result = mergeField(pass.origin, observations);
    const written = await fanOut(capable, pass, result);

    return new PassRecord({ field: pass.field, result, written, skipped });
  }
}

async function observeMirror(
  mirror: RegisteredAdapter,
  pass: MirrorSyncPass,
): Promise<SideObservation> {
  const task = await mirror.tasks.readTask(pass.entityId);
  const fieldTime = mirror.timestamps
    ? await mirror.timestamps.fieldTime(pass.entityId, pass.field)
    : null;

  return new SideObservation({
    side: mirror.descriptor.applicationId,
    role: 'mirror',
    current: task === null ? null : canonicalValue(task, pass.field),
    baseline: pass.baselines.get(mirror.descriptor.applicationId) ?? null,
    fieldTime,
    timestampTrustworthy: mirror.descriptor.capabilities.includes(
      'trustworthy per-field timestamps',
    ),
    completeFetch: mirror.completeFetch
      ? mirror.completeFetch.fetchComplete()
      : false,
    currentCompleted: task === null ? false : task.completed,
  });
}

async function fanOut(
  capable: readonly RegisteredAdapter[],
  pass: MirrorSyncPass,
  result: MergeResult,
): Promise<string[]> {
  const written: string[] = [];

  if (result.outcome === 'value') {
    for (const mirror of capable) {
      const task = await mirror.tasks.readTask(pass.entityId);
      if (task !== null && canonicalValue(task, pass.field) === result.value) {
        continue;
      }
      await mirror.tasks.applyField(
        new CanonicalFieldWrite({
          handle: pass.entityId,
          field: pass.field,
          value: result.value,
        }),
      );
      written.push(mirror.descriptor.applicationId);
    }
  } else if (result.outcome === 'delete') {
    for (const mirror of capable) {
      const task = await mirror.tasks.readTask(pass.entityId);
      if (task === null) {
        continue;
      }
      await mirror.tasks.deleteTask(pass.entityId);
      written.push(mirror.descriptor.applicationId);
    }
  }

  return written;
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
