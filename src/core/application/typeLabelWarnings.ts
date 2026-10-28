import { resolveTypeLabel } from '../domain/note.js';

export function warnOnExtraTypeLabels(labels: readonly string[]): void {
  const { kind, hasExtraTypeLabels } = resolveTypeLabel(labels);
  if (hasExtraTypeLabels) {
    console.warn(
      `labels carry more than one kind label; using "${kind}" and ignoring the rest`,
    );
  }
}
