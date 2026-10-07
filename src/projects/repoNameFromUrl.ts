// The repository's name — the board title the derivation ladder keys on —
// parsed from its url: https://github.com/<owner>/<name> -> <name>. Returns ''
// for a url that carries no name, so the caller treats it as underivable rather
// than guessing.
export function repoNameFromUrl(repoUrl: string): string {
  let segments: string[];
  try {
    segments = new URL(repoUrl).pathname
      .split('/')
      .filter((segment) => segment.length > 0);
  } catch {
    return '';
  }
  return segments[1] ?? '';
}
