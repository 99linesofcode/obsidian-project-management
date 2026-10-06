// The payload a vault-born task renders into a new code-host issue. The type is
// the vault-owned content type; the adapter renders it as the `type:*` label
// (the mirror's representation of the vault-owned type), so the created issue
// is immediately tracked by the same gate that adopts typed issues.
//
// WHY this lives in the shared kernel: the port that accepts it is the core's
// need, owned by no provider, and the name carries no provider vocabulary.
export interface CreateIssueData {
  title: string;
  body: string;
  type: string;
}
