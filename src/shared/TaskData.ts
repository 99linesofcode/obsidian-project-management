import { DataTransferObject } from './DataTransferObject.js';

// The fields a TaskData is built from. Named so a construction site reads as a
// record rather than a row of positional slots — an empty mirror map or type is
// explicit, not a mystery argument.
export interface TaskDataInit {
  id: string;
  notePath: string;
  mirrors: Record<string, string>;
  title: string;
  body: string;
  status: string;
  completedAt: string | null;
  type: string;
  parent: string | null;
  createdAt: string | null;
  updatedAt: string | null;
}

// The canonical task: one provider-neutral shape for a code-host issue, a task-manager
// task and a vault task note. Identity and provenance link the representations;
// the content fields are the shape the diff compares. Provider transport DTOs
// provider DTOs are mapped onto this at the boundary by the
// mappers; the core never sees a provider shape.
export class TaskData extends DataTransferObject {
  id: string; // uuid — vault-owned, assigned at creation
  notePath: string; // mutable location; renames are a field update
  mirrors: Record<string, string>; // live-view handles: { github: url, todoist: id }
  title: string;
  body: string; // real body on live views; digest on diff views
  status: string; // lane name; '' = not on a board
  completedAt: string | null; // ISO; invariant: status===doneLane <=> completedAt!==null
  type: string; // vault-owned; mirrors translate it
  parent: string | null; // parent's uuid
  createdAt: string | null;
  updatedAt: string | null;

  constructor(init: TaskDataInit) {
    super();
    this.id = init.id;
    this.notePath = init.notePath;
    this.mirrors = init.mirrors;
    this.title = init.title;
    this.body = init.body;
    this.status = init.status;
    this.completedAt = init.completedAt;
    this.type = init.type;
    this.parent = init.parent;
    this.createdAt = init.createdAt;
    this.updatedAt = init.updatedAt;
  }

  // Called on DIFF VIEWS only — the body is a digest there (see toDiffView).
  // Identity (id, notePath, mirrors) and provenance (createdAt, updatedAt) are
  // excluded: they move without being content changes.
  override canonical(): string {
    return [
      this.title,
      this.body,
      this.status,
      this.completedAt ?? '',
      this.type,
      this.parent ?? '',
    ].join('\u0000');
  }
}
