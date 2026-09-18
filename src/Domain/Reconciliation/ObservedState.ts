// The three views of one task that a sync reconciles: the note as it exists
// now, the remote as fetched now, and the baseline of what the last sync saw.
export interface NoteView {
  body: string;
  status: 'open' | 'done';
}

export interface RemoteView {
  body: string;
  status: 'open' | 'done';
  updatedAt: string;
}

export interface BaselineView {
  lastSyncedBodyHash: string;
  lastSyncedRemoteUpdatedAt: string;
  lastSyncedStatus: 'open' | 'done';
}

// An immutable snapshot of one task's three views, handed to the verdict
// resolver so it can decide which way each dimension should move.
export class ObservedState {
  readonly note: NoteView;
  readonly remote: RemoteView;
  readonly baseline: BaselineView;

  constructor(note: NoteView, remote: RemoteView, baseline: BaselineView) {
    this.note = note;
    this.remote = remote;
    this.baseline = baseline;
  }
}
