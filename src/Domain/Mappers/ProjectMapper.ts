import { ProjectData } from '../DataTransferObjects/ProjectData.js';
import type { ProjectStatusOption } from '../DataTransferObjects/ProjectIdentityData.js';
import type { TodoistProjectData } from '../DataTransferObjects/TodoistProjectData.js';

// The provider payloads a project read maps onto the canonical ProjectData.
// WHY a pure mapper and not adapter-inline: the boundary rule is one canonical
// shape per datum, and a pure mapping is testable without a transport. The
// adapter owns the transport; this owns the translation.
export interface GithubProjectPayload {
  id: string;
  name: string;
  closed: boolean;
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
  // github mirror handle; a provider without a repo (Todoist) leaves it ''.
  repoUrl: string;
}

export const ProjectMapper = {
  // A GitHub ProjectV2 payload: the board's title, closed state and Status
  // option names become the canonical content. The option ids stay in
  // ProjectIdentityData (attach-time addressing), never in ProjectData.
  fromGithubProject(
    payload: GithubProjectPayload,
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

  // A Todoist project payload: the name and is_archived become the canonical
  // content. Todoist has no lane vocabulary of its own (sections are created
  // from the board's lanes), so statusOptions is empty and the done lane is
  // the core's setting.
  fromTodoistProject(
    payload: TodoistProjectData,
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
      null,
      null,
    );
  },
};