// The handle a freshly created issue resolves to. The url is the github mirror
// handle (stable, human-meaningful); the node id is adapter-internal and only
// carried so a caller can act on the issue without a re-fetch.
export interface IssueHandleData {
  url: string;
  nodeId: string;
}