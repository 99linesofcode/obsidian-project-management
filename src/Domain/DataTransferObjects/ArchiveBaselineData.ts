// The last tick's reconciled archive observation for a project, in the shape
// the core needs. It is the shared baseline a three-way merge compares against:
// locationArchived is the vault location (Archief/ vs Projecten/) and closed is
// the board state, both as last reconciled. A settled project has the two equal.
export interface ArchiveBaselineData {
  locationArchived: boolean;
  closed: boolean;
}
