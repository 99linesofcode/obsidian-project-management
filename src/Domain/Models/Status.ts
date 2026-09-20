// The per-note sync record: what the note last saw from the remote, so a
// later sync can tell whether the note or the remote changed. notePath is
// where the note lives, kept in sync across renames. lastSyncedTitle is the
// remote title at last sync, so a local filename rename can be detected.
// lastSyncedStatus is the project's Status option name the task sat in.
export interface Status {
  url: string;
  remoteId: number;
  notePath: string;
  lastSyncedBodyHash: string;
  lastSyncedRemoteUpdatedAt: string;
  lastSyncedStatus: string;
  lastSyncedTitle: string;
}
