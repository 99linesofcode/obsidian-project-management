// A project note discovered in the vault: the note that declares a synced
// project via its frontmatter. projectName is derived from the note's path
// (Projecten/<project>/_home.md or Archief/<project>/_home.md -> <project>);
// archived is true when the note lives under Archief/; pm, url and board come
// from the same frontmatter.
export interface ProjectNoteData {
  path: string;
  projectName: string;
  archived: boolean;
  pm: string;
  url: string;
  board: string;
}
