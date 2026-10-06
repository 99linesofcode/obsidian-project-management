import { DataTransferObject } from './DataTransferObject.js';

// The canonical project: one provider-neutral shape for a GitHub project and a
// Todoist project. Identity and provenance link the representations; the
// content fields are the shape the diff compares. The lane vocabulary is
// project-owned; every mapper translates against it.
export class ProjectData extends DataTransferObject {
  id: string;
  path: string; // mutable location
  mirrors: Record<string, string>;
  name: string;
  archivedAt: string | null; // plugin-stamped at the freeze transition
  statusOptions: string[];
  doneLane: string;
  createdAt: string | null;
  updatedAt: string | null;

  constructor(
    id: string,
    path: string,
    mirrors: Record<string, string>,
    name: string,
    archivedAt: string | null,
    statusOptions: string[],
    doneLane: string,
    createdAt: string | null,
    updatedAt: string | null,
  ) {
    super();
    this.id = id;
    this.path = path;
    this.mirrors = mirrors;
    this.name = name;
    this.archivedAt = archivedAt;
    this.statusOptions = statusOptions;
    this.doneLane = doneLane;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  // Called on DIFF VIEWS only. Identity and provenance are excluded.
  // WHY the lane vocabulary is NUL-joined: the contract delimits every field
  // with \u0000, so a ',' inside a lane name would let two different
  // vocabularies collide on one canonical string. The delimiter must be the
  // same one the field boundaries use.
  override canonical(): string {
    return [
      this.name,
      this.archivedAt ?? '',
      this.statusOptions.join('\u0000'),
      this.doneLane,
    ].join('\u0000');
  }
}
