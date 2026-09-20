// The issue state a lane implies: the done lane closes the issue, every
// other lane leaves it open. This is the single coupling between the board's
// lanes and the issue state.
export function stateFromStatus(
  statusName: string,
  doneOptionName: string,
): 'open' | 'closed' {
  return statusName === doneOptionName ? 'closed' : 'open';
}
