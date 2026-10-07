import type { ProjectData } from './ProjectData.js';

// A code-host board from the viewer's project listing (PRJ-3): the canonical
// board content plus the repositories the board is linked to. WHY the linked
// repositories ride beside ProjectData rather than inside it: ProjectData is
// the provider-neutral project shape shared with the task manager, while a
// board's linked repos are a code-host fact the board-born capture needs to
// derive the connection's repository. Only the capture consumes this DTO.
export interface RemoteBoardData {
  project: ProjectData;
  repoUrls: string[];
}
