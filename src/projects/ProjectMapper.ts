import { ProjectData } from '../shared/ProjectData.js';
import type { ProjectStatusOption } from './ProjectIdentityData.js';
import type { RemoteProjectData } from '../shared/RemoteProjectData.js';

// The provider payloads a project read maps onto the canonical ProjectData.
// WHY a pure mapper and not adapter-inline: the boundary rule is one canonical
// shape per datum, and a pure mapping is testable without a transport. The
// adapter owns the transport; this owns the translation.
export interface CodeHostProjectPayload {
  id: string;
  name: string;
  closed: boolean;
  statusOptions: ProjectStatusOption[];
}

// A board from the viewer's project list (PRJ-3): the same content as a
// CodeHostProjectPayload plus the two things a listing carries that a single
// board read does not — the board's own url (the note's `board:` anchor) and
// its creation clock (the capture cursor).
export interface CodeHostBoardPayload {
  id: string;
  name: string;
  closed: boolean;
  createdAt: string | null;
  url: string;
  statusOptions: ProjectStatusOption[];
}

// The core-owned context a provider payload cannot supply: the project's
// location, the plugin's done-lane setting, and the reconciled archive stamp.
// WHY the stamp is context and not derived from the payload: the provider only
// knows a boolean (closed/isArchived); the plugin-stamped transition time is a
// core fact, so the mapper carries it through rather than inventing one.
export interface ProjectMapContext {
  path: string;
  doneLane: string;
  archivedAt: string | null;
  // The project's remote address, when the provider has one. It becomes the
  // code-host mirror handle; a provider without a repo leaves it ''.
  repoUrl: string;
}

export const ProjectMapper = {
  // A code-host project payload: the board's title, closed state and Status
  // option names become the canonical content. The option ids stay in
  // ProjectIdentityData (attach-time addressing), never in ProjectData.
  fromCodeHostProject(
    payload: CodeHostProjectPayload,
    context: ProjectMapContext,
  ): ProjectData {
    return new ProjectData(
      payload.id,
      context.path,
      { github: context.repoUrl },
      payload.name,
      payload.closed ? (context.archivedAt ?? '') : null,
      payload.statusOptions.map((option) => option.name),
      context.doneLane,
      null,
      null,
    );
  },

  // A task-manager project payload: the name and is_archived become the
  // canonical content. A task manager has no lane vocabulary of its own
  // (sections are created from the board's lanes), so statusOptions is empty
  // and the done lane is the core's setting. createdAt is the provider's
  // creation clock the capture cursor compares against; a missing clock is null
  // (never treated as new).
  fromRemoteProject(
    payload: RemoteProjectData,
    context: ProjectMapContext,
  ): ProjectData {
    return new ProjectData(
      payload.id,
      context.path,
      { todoist: payload.id },
      payload.name,
      payload.isArchived ? (context.archivedAt ?? '') : null,
      [],
      context.doneLane,
      payload.createdAt ?? null,
      null,
    );
  },

  // A code-host board from the viewer's project list (PRJ-3). The board's url
  // is the project's remote address until a repository is attached (ATT-1), so
  // it becomes the code-host mirror handle; createdAt is the capture cursor's
  // clock. Option ids stay in ProjectIdentityData, exactly as for
  // fromCodeHostProject.
  fromCodeHostBoard(
    payload: CodeHostBoardPayload,
    context: ProjectMapContext,
  ): ProjectData {
    return new ProjectData(
      payload.id,
      context.path,
      { github: payload.url },
      payload.name,
      payload.closed ? (context.archivedAt ?? '') : null,
      payload.statusOptions.map((option) => option.name),
      context.doneLane,
      payload.createdAt,
      null,
    );
  },
};
