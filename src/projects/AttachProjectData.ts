// Input for resolving a project note's GitHub identities. Maps 1:1 onto the
// sync frontmatter a project note carries (pm, url, board).
export interface AttachProjectData {
  pm: string;
  repoUrl: string;
  boardUrl: string;
}
