// The per-note sync record: what the note last saw from the remote, so a
// later sync can tell whether the note or the remote changed. notePath is
// where the note lives, kept in sync across renames.
export interface Status {
  url: string;
  remoteId: number;
  notePath: string;
  lastSyncedBodyHash: string;
  lastSyncedRemoteUpdatedAt: string;
  lastSyncedStatus: 'open' | 'done';
}
