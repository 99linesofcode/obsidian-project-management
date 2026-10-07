import { laneForSection } from '../tasks/laneForSection.js';
import { hasCompletionStamp } from '../shared/Reconciliation.js';
import { rewriteFrontmatterFields } from '../vault/rewriteFrontmatterFields.js';
import { parseAffiliation } from '../shared/parseAffiliation.js';
import {
  affiliationTargets,
  projectAffiliationLink,
} from '../shared/projectAffiliation.js';
import { normalizedStem, stemOf } from '../shared/stemOf.js';
import { slugify } from '../vault/TaskNoteMapper.js';
import { splitFrontmatter } from '../vault/splitFrontmatter.js';
import { withStatus } from '../vault/TaskNoteParser.js';
import { TaskData } from '../shared/TaskData.js';
import type { TodoistTaskSnapshotData } from './TodoistTaskSnapshotData.js';
import { toDiffViewWithBody } from '../shared/toDiffView.js';
import type { TodoistTaskData } from './TodoistTaskData.js';
import { todoistEntries } from '../registry/todoistEntries.js';
import type { EntityRecord, SyncStatePort } from '../shared/SyncStatePort.js';
import type { VaultPort } from '../shared/VaultPort.js';
import type { PropagateStatusAction } from '../tasks/PropagateStatusAction.js';
import type { RelinkRenamedTodoAction } from './RelinkRenamedTodoAction.js';
import type { RelocateTaskStatusAction } from '../tasks/RelocateTaskStatusAction.js';

export interface ApplyTodoistRemoteChangesInput {
  projectName: string;
  connectionSlug: string;
  githubConnectionSlug: string | null;
  syncedAt: string;
  snapshot: TodoistTaskSnapshotData;
}

interface VaultFields {
  status: string;
  affiliation: string[];
}

interface VerdictContext {
  projectName: string;
  connectionSlug: string;
  syncedAt: string;
  sections: Record<string, string>;
  defaultLane: string | null;
  doneLane: string;
  hasLanes: boolean;
  stemByTwinId: Map<string, string>;
  uuidByTwinId: Map<string, string>;
  githubHandleByEntity: Map<string, string>;
  githubConnectionSlug: string | null;
}

export class ApplyTodoistRemoteChangesAction {
  constructor(
    private readonly vault: VaultPort,
    private readonly syncState: SyncStatePort,
    private readonly propagateStatus: PropagateStatusAction,
    private readonly relocateTaskStatus: RelocateTaskStatusAction,
    private readonly relinkRenamedTodo: RelinkRenamedTodoAction,
    private readonly doneOptionName: string,
  ) {}

  async execute(input: ApplyTodoistRemoteChangesInput): Promise<void> {
    const portState = await this.syncState.getPortState(
      input.projectName,
      input.connectionSlug,
    );
    const sections = portState?.lanes ?? {};

    const { completed, active } = input.snapshot;
    const twinById = new Map<string, TodoistTaskData>();
    for (const twin of completed) {
      twinById.set(twin.id, twin);
    }
    for (const twin of active) {
      twinById.set(twin.id, twin);
    }

    const identity =
      input.githubConnectionSlug === null
        ? null
        : await this.syncState.getIdentity(
            input.projectName,
            input.githubConnectionSlug,
          );
    const hasLanes = (identity?.statusOptions.length ?? 0) > 0;
    const defaultLane = identity?.statusOptions[0]?.name ?? null;

    const records = await todoistEntries(
      this.syncState,
      input.connectionSlug,
      input.projectName,
    );
    const stemByTwinId = new Map<string, string>();
    const uuidByTwinId = new Map<string, string>();
    for (const entry of records) {
      stemByTwinId.set(entry.handle, stemOf(entry.record.notePath));
      uuidByTwinId.set(entry.handle, entry.record.id);
    }
    const githubHandleByEntity = new Map<string, string>();
    if (input.githubConnectionSlug !== null) {
      for (const { handle, item } of await this.syncState.listMirrorItems(
        input.projectName,
        input.githubConnectionSlug,
      )) {
        githubHandleByEntity.set(item.entityId, handle);
      }
    }

    const context: VerdictContext = {
      projectName: input.projectName,
      connectionSlug: input.connectionSlug,
      syncedAt: input.syncedAt,
      sections,
      defaultLane,
      doneLane: this.doneOptionName,
      hasLanes,
      stemByTwinId,
      uuidByTwinId,
      githubHandleByEntity,
      githubConnectionSlug: input.githubConnectionSlug,
    };

    for (const entry of records) {
      const twin = twinById.get(entry.handle);
      if (!twin) {
        if (hasCompletionStamp(entry.base)) {
          continue;
        }
        if (await this.vault.getNoteByPath(entry.record.notePath)) {
          await this.syncState.removeEntity(entry.record.id);
        }
        continue;
      }
      if (twin.isCompleted || hasCompletionStamp(entry.base)) {
        continue;
      }
      await this.applyVerdict(
        entry.record,
        entry.handle,
        entry.base,
        twin,
        context,
      );
    }
  }

  private async applyVerdict(
    record: EntityRecord,
    handle: string,
    base: TaskData | null,
    twin: TodoistTaskData,
    context: VerdictContext,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(record.notePath);
    if (!note) {
      return;
    }
    const fields = readVaultFields(note.content);
    if (!fields) {
      return;
    }

    const isTask = isTaskPath(record.notePath, context.projectName);
    const topLevel = twin.parentId === null;
    const laneControlled = isTask && topLevel && context.hasLanes;
    const remoteLane = laneControlled
      ? (laneForSection(context.sections, twin.sectionId) ??
        context.defaultLane)
      : null;
    const remoteParent = parentUuid(context, twin.parentId);

    const baseContent = base?.title ?? '';
    const baseLane =
      base?.status === undefined || base.status === '' ? null : base.status;
    const baseParent = base?.parent ?? null;

    const contentChanged = twin.content !== baseContent;
    const laneChanged =
      laneControlled && baseLane !== null && remoteLane !== baseLane;
    const parentChanged = remoteParent !== baseParent;

    const vaultLane = laneControlled ? fields.status : null;
    const vaultParent = parentUuidFromAffiliation(
      fields.affiliation,
      context,
      isTask,
    );
    const localContentChanged =
      slugify(baseContent) !== normalizedStem(record.notePath);
    const localLaneChanged = baseLane !== null && vaultLane !== baseLane;
    const localParentChanged =
      vaultParent !== undefined && vaultParent !== baseParent;

    const remoteChanged = contentChanged || laneChanged || parentChanged;
    const localChanged =
      localContentChanged || localLaneChanged || localParentChanged;

    if (remoteChanged && localChanged) {
      await this.stamp(
        record,
        handle,
        base,
        twin,
        remoteLane,
        remoteParent,
        context.projectName,
        context.connectionSlug,
      );
      return;
    }

    if (remoteChanged) {
      let notePath = record.notePath;
      if (contentChanged) {
        notePath = await this.renameNote(notePath, twin, isTask, context);
      }
      if (laneChanged && remoteLane !== null) {
        await this.applyLane(notePath, remoteLane, record, context);
      }
      if (parentChanged) {
        await this.applyParent(notePath, twin.parentId, context, isTask);
      }
      await this.stamp(
        record,
        handle,
        base,
        twin,
        remoteLane,
        remoteParent,
        context.projectName,
        context.connectionSlug,
      );
    }
  }

  private async renameNote(
    oldPath: string,
    twin: TodoistTaskData,
    isTask: boolean,
    context: VerdictContext,
  ): Promise<string> {
    const newPath = isTask
      ? taskRenameTarget(context.projectName, oldPath, twin.content)
      : `Projecten/${context.projectName}/todos/${slugify(twin.content)}.md`;
    if (newPath === oldPath) {
      return oldPath;
    }

    await this.vault.renameNote(oldPath, newPath);
    if (isTask) {
      await this.relocateTaskStatus.execute({ oldPath, newPath });
    } else {
      await this.relinkRenamedTodo.execute({
        oldPath,
        newPath,
        syncedAt: context.syncedAt,
      });
    }
    return newPath;
  }

  private async applyLane(
    notePath: string,
    lane: string,
    record: EntityRecord,
    context: VerdictContext,
  ): Promise<void> {
    const note = await this.vault.getNoteByPath(notePath);
    if (!note) {
      return;
    }
    await this.vault.writeNote(notePath, withStatus(note.content, lane));

    const url = context.githubHandleByEntity.get(record.id) ?? '';
    if (url !== '' && context.githubConnectionSlug !== null) {
      await this.propagateStatus.execute({
        url,
        statusName: lane,
        notePath,
        projectName: context.projectName,
        connectionSlug: context.githubConnectionSlug,
      });
    }
  }

  private async applyParent(
    notePath: string,
    remoteParentTwin: string | null,
    context: VerdictContext,
    isTask: boolean,
  ): Promise<void> {
    if (!isTask) {
      return;
    }
    let parentLink: string | null = null;
    if (remoteParentTwin !== null) {
      parentLink = context.stemByTwinId.get(remoteParentTwin) ?? null;
      if (parentLink === null) {
        return;
      }
    }

    const note = await this.vault.getNoteByPath(notePath);
    if (!note) {
      return;
    }

    const currentLinks = affiliationTargets(
      parseAffiliation(
        splitFrontmatter(note.content)?.fields.get('affiliation'),
      ),
      context.projectName,
    );
    const currentParent = currentLinks[0] ?? null;
    if (currentParent === parentLink) {
      return;
    }

    const links = [projectAffiliationLink(context.projectName)];
    if (parentLink !== null) {
      links.push(`[[${parentLink}]]`);
    }
    const value = `[${links.map((link) => `"${link}"`).join(', ')}]`;
    await this.vault.writeNote(notePath, withAffiliation(note.content, value));
  }

  private async stamp(
    record: EntityRecord,
    handle: string,
    previous: TaskData | null,
    twin: TodoistTaskData,
    remoteLane: string | null,
    remoteParent: string | null,
    projectName: string,
    connectionSlug: string,
  ): Promise<void> {
    const view = toDiffViewWithBody(
      new TaskData({
        id: record.id,
        notePath: record.notePath,
        mirrors: {},
        title: twin.content,
        body: '',
        status: remoteLane ?? '',
        completedAt: null,
        type: '',
        parent: remoteParent,
        createdAt: previous?.createdAt ?? null,
        updatedAt: twin.updatedAt || null,
      }),
    );
    await this.syncState.setMirrorItem(projectName, connectionSlug, handle, {
      entityId: record.id,
      base: view,
    });
  }
}

function parentUuid(
  context: VerdictContext,
  twinId: string | null,
): string | null {
  if (twinId === null) {
    return null;
  }
  return context.uuidByTwinId.get(twinId) ?? null;
}

function parentUuidFromAffiliation(
  affiliation: string[],
  context: VerdictContext,
  isTask: boolean,
): string | null | undefined {
  const targets = affiliationTargets(affiliation, context.projectName);
  const parentLink = isTask ? targets[0] : (targets[1] ?? targets[0]);
  if (parentLink === undefined) {
    return null;
  }
  const twinId = context.stemByTwinId.get(parentLink);
  if (twinId === undefined) {
    return undefined;
  }
  return context.uuidByTwinId.get(twinId) ?? undefined;
}

function taskRenameTarget(
  projectName: string,
  oldPath: string,
  content: string,
): string {
  const prefix = stemOf(oldPath).match(/^(\d+)-/)?.[1];
  const stem =
    prefix === undefined ? slugify(content) : `${prefix}-${slugify(content)}`;
  return `Projecten/${projectName}/taken/${stem}.md`;
}

function withAffiliation(content: string, value: string): string {
  return rewriteFrontmatterFields(
    content,
    new Map([['affiliation', value]]),
    true,
  );
}

function readVaultFields(content: string): VaultFields | null {
  const split = splitFrontmatter(content);
  if (!split) {
    return null;
  }
  const status = split.fields.get('status');
  if (status === undefined) {
    return null;
  }
  return {
    status,
    affiliation: parseAffiliation(split.fields.get('affiliation')),
  };
}

function isTaskPath(path: string, projectName: string): boolean {
  return path.startsWith(`Projecten/${projectName}/taken/`);
}
