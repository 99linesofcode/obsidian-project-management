// The vault-owned content type carried by a `type:*` label, or '' when the
// label set carries none. The prefix is stripped and the remainder trimmed, so
// both the spaced (`type: task`) and legacy (`type:task`) conventions resolve.
// This is the ONE type-from-labels rule: every surface that reads a type off
// labels routes here, so a non-type label (e.g. `priority:high`) is never
// mistaken for the type.
export function typeFromLabels(labels: string[]): string {
  const label = labels.find((candidate) => candidate.startsWith('type:'));
  return label === undefined ? '' : label.slice('type:'.length).trim();
}
