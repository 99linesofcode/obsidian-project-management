// Whether two label sets carry the same labels, order-insensitively. The
// projection derives labels, so a reordered set is not a change.
export function sameLabels(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((label, index) => label === sortedB[index]);
}
