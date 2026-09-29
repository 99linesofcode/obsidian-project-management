import { DataTransferObject } from './DataTransferObject.js';

// The canonical task: one provider-neutral shape for a GitHub issue, a Todoist
// task and a vault task note. Identity and provenance link the representations;
// the content fields are the shape the diff compares. Provider transport DTOs
// (GithubTaskData, TodoistTaskData) are mapped onto this at the boundary by the
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

  constructor(
    id: string,
    notePath: string,
    mirrors: Record<string, string>,
    title: string,
    body: string,
    status: string,
    completedAt: string | null,
    type: string,
    parent: string | null,
    createdAt: string | null,
    updatedAt: string | null,
  ) {
    super();
    this.id = id;
    this.notePath = notePath;
    this.mirrors = mirrors;
    this.title = title;
    this.body = body;
    this.status = status;
    this.completedAt = completedAt;
    this.type = type;
    this.parent = parent;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
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
