// The per-item Todoist bookkeeping, in the shape the core needs. It lives in
// data.json, never in notes (dt-04). todoistId is the Todoist task id; notePath
// is the vault note it mirrors (rename propagation, same as Status);
// lastSyncedHash is the snapshot over content, labels, section, parent and
// is_completed (dt-08), stamped after every write so t5 can tell a remote
// change from an echo of our own write. lastSyncedCompleted is the completion
// bit that snapshot carried: a twin active again while this says completed is a
// remote reopen, told apart from a vault-side completion. It mirrors Status's
// lastSyncedStatus, the same baseline the GitHub side keeps for its status.
//
// The per-field bases below complete the dt-08 three-way merge: the snapshot
// hash alone cannot say *which* field moved, so a remote change and a vault
// change would be indistinguishable. They are optional so records written
// before t5 still load — a missing base is treated as unknown and re-stamped on
// first sight (the vault is the source of truth, so an unobserved change is
// resolved by the projection re-pushing the vault state).
export interface TodoistStateData {
  todoistId: string;
  notePath: string;
  lastSyncedHash: string;
  lastSyncedCompleted: boolean;
  // The item's content at last agreement (the projection's title / the
  // checklist line text).
  lastSyncedContent?: string;
  // The lane name (section name) a top-level task last sat in; null when the
  // lane is not controlled (a subtask inherits its parent's section, dt-02).
  lastSyncedLane?: string | null;
  // The parent twin id at last agreement (the slice twin for a task child, the
  // task twin for a to-do); null for a top-level item.
  lastSyncedParent?: string | null;
}
