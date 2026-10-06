// The lane an issue's state implies when the board is not the source: a
// closed issue sits in the done lane, an open one in the default lane.
export function statusNameFromState(
  state: 'open' | 'closed',
  doneOptionName: string,
  defaultOptionName: string,
): string {
  return state === 'closed' ? doneOptionName : defaultOptionName;
}
