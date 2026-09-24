// Resolves a template's {{date}}/{{time}} placeholders to the sync stamp.
export function replaceTimestampPlaceholders(
  template: string,
  syncedAt: string,
): string {
  return template
    .replaceAll('{{date}}', syncedAt.slice(0, 10))
    .replaceAll('{{time}}', syncedAt.slice(11, 16));
}
