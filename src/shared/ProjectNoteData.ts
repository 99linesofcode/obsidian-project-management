// A project note discovered in the vault: the pm-marked note directly inside a
// project folder. projectName is ALWAYS the folder name
// (Projecten/<project>/_<project>.md or Archief/<project>/_<project>.md ->
// <project>); the legacy forms (`_home.md` and `<name>.md`) are accepted too,
// so discovery needs no rename — the reconcile pass migrates them to the
// convention. archivedAt is derived from the location: null when the note sits
// under Projecten/, '' when it sits under Archief/ but the real transition
// stamp is not yet known (discovery/adoption). The reconcile pass owns the
// authoritative stamp and persists it on the archive baseline. pm and url come
// from the same frontmatter; the board is derived from the repo, never read.
export interface ProjectNoteData {
  path: string;
  projectName: string;
  archivedAt: string | null;
  pm: string;
  url: string;
}
