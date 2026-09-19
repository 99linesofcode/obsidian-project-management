// A task is worth tracking only when it carries a `type` label — the label
// says what kind of work it is (type: task, type: slice, ...). Untyped tasks
// were not deemed worthy of tracking and are never synced.
export function hasTypeLabel(labels: string[]): boolean {
  return labels.some((label) => label.startsWith('type:'));
}
