// A note's filename stem: its basename without the .md extension.
export function stemOf(path: string): string {
  const basename = path.split('/').pop() ?? '';
  return basename.replace(/\.md$/, '');
}

// The comparison stem of a note: its filename stem with a legacy leading
// `<remoteId>-` ordinal prefix stripped and lowercased. Filenames carry zero
// identity weight, so the prefix is presentation, not identity.
export function normalizedStem(path: string): string {
  return stemOf(path).replace(/^\d+-/, '').toLowerCase();
}
