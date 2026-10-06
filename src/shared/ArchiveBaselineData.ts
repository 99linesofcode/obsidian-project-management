// The last tick's reconciled archive observation for a project, in the shape
// the core needs. It is the shared baseline a three-way merge compares against:
// locationArchived is the vault location (Archief/ vs Projecten/) and closed is
// the board state, both as last reconciled. A settled project has the two equal.
// archivedAt is the plugin-stamped freeze-transition time: null while active,
// the transition's syncedAt once archived, and '' when the project was already
// archived before a stamp existed (migration), matching the migrated-completion
// convention.
export interface ArchiveBaselineData {
  locationArchived: boolean;
  closed: boolean;
  archivedAt: string | null;
}
