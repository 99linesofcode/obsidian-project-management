// A GitHub issue as fetched from the provider, in the shape the port carries.
// This is a provider transport DTO, not the domain shape: GithubTaskMapper maps
// it (with its board card) onto the canonical TaskData at the boundary.
export interface GithubTaskData {
  url: string;
  remoteId: number;
  nodeId: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  updatedAt: string;
  labels: string[];
}
