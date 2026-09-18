// The per-note sync record: what the note last saw from the remote, so a
// later sync can tell whether the note or the remote changed.
export interface Status {
  url: string;
  remoteId: number;
  lastSyncedBodyHash: string;
  lastSyncedRemoteUpdatedAt: string;
  lastSyncedStatus: 'open' | 'done';
}
