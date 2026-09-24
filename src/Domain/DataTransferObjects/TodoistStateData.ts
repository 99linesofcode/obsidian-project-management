// The per-item Todoist bookkeeping, in the shape the core needs. It lives in
// data.json, never in notes (dt-04). todoistId is the Todoist task id; notePath
// is the vault note it mirrors (rename propagation, same as Status);
// lastSyncedHash is the snapshot over content, labels, section, parent and
// is_completed (dt-08), stamped after every write so t5 can tell a remote
// change from an echo of our own write. lastSyncedCompleted is the completion
// bit that snapshot carried: a twin active again while this says completed is a
// remote reopen, told apart from a vault-side completion. It mirrors Status's
// lastSyncedStatus, the same baseline the GitHub side keeps for its status.
export interface TodoistStateData {
  todoistId: string;
  notePath: string;
  lastSyncedHash: string;
  lastSyncedCompleted: boolean;
}
