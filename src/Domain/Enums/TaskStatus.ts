// The sync status of a task note, derived from the remote issue state.
export enum TaskStatus {
  Open = 'open',
  Done = 'done',
}

// Maps a remote issue state onto the note's status. Closed is done; anything
// else (open) is open.
export function taskStatusFromState(state: 'open' | 'closed'): TaskStatus {
  return state === 'closed' ? TaskStatus.Done : TaskStatus.Open;
}
