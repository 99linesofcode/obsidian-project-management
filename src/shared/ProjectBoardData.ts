import type { ProjectStatusOption } from './ProjectIdentityData.js';

// The addressing a freshly created code-host board resolves to. WHY a
// dedicated DTO and not ProjectData: ProjectData is canonical CONTENT (name,
// archivedAt, status option NAMES, done lane); the board node id, Status field
// id and option IDs are attach-time ADDRESSING that belongs in the registry's
// ProjectIdentityData, never in the canonical shape. createProject returns this
// storage shape so the lifecycle can merge it into the identity record.
export interface ProjectBoardData {
  projectNodeId: string;
  boardUrl: string;
  statusFieldId: string;
  statusOptions: ProjectStatusOption[];
}
