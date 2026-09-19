// A remote task as fetched from the provider, in the shape the core needs.
// The core never sees raw provider JSON; t4's fetch produces this.
export interface TaskData {
  url: string;
  remoteId: number;
  nodeId: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  updatedAt: string;
  labels: string[];
}
