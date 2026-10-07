// Input for resolving a project note's code-host identities: the repository and
// the board to adopt. The board is derived from the repository, so a repo with
// no board yet carries an empty boardUrl.
export interface AttachProjectData {
  repoUrl: string;
  boardUrl: string;
}
