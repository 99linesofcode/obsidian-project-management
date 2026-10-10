import { DataTransferObject } from './DataTransferObject.js';

export class TaskDataTransferObject extends DataTransferObject {
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

  constructor(init: Omit<TaskDataTransferObject, keyof DataTransferObject>) {
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
