// The payload a vault-born task renders into a new GitHub issue. The type is
// the vault-owned content type; the adapter renders it as the `type:*` label
// (the mirror's representation of the vault-owned type), so the created issue
// is immediately tracked by the same gate that adopts typed issues.
export interface CreateIssueData {
  title: string;
  body: string;
  type: string;
}