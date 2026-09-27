// A project note discovered in the vault: the pm-marked note directly inside a
// project folder. projectName is ALWAYS the folder name
// (Projecten/<project>/_home.md or Archief/<project>/_home.md -> <project>);
// the legacy <name>.md note is accepted too, so no user file is renamed
// unbidden. archived is true when the note lives under Archief/; pm, url and
// board come from the same frontmatter.
export interface ProjectNoteData {
  path: string;
  projectName: string;
  archived: boolean;
  pm: string;
  url: string;
  board: string;
}
