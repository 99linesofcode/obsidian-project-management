// A project note discovered in the vault: the pm-marked note directly inside a
// project folder. projectName is ALWAYS the folder name
// (Projecten/<project>/_home.md or Archief/<project>/_home.md -> <project>);
// the legacy <name>.md note is accepted too, so no user file is renamed
// unbidden. archivedAt is derived from the location: null when the note sits
// under Projecten/, '' when it sits under Archief/ but the real transition
// stamp is not yet known (discovery/adoption). The reconcile pass owns the
// authoritative stamp and persists it on the archive baseline. pm, url and
// board come from the same frontmatter.
export interface ProjectNoteData {
  path: string;
  projectName: string;
  archivedAt: string | null;
  pm: string;
  url: string;
  board: string;
}
