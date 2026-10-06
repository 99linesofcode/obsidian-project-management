// The handle a freshly created issue resolves to. The url is the code-host
// mirror handle (stable, human-meaningful); the node id is adapter-internal and
// only carried so a caller can act on the issue without a re-fetch.
//
// WHY this lives in the shared kernel: it is the return type of a port method
// owned by no provider, and the name is provider-neutral.
export interface IssueHandleData {
  url: string;
  nodeId: string;
}
