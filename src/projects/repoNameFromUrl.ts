// The repository's name — the board title the derivation ladder keys on —
// parsed from its url: https://github.com/<owner>/<name> -> <name>. A trailing
// `.git` is stripped, so a clone url and its web url derive the same name.
// Returns '' for a url that carries no name, so the caller treats it as
// underivable rather than guessing.
export function repoNameFromUrl(repoUrl: string): string {
  let segments: string[];
  try {
    segments = new URL(repoUrl).pathname
      .split('/')
      .filter((segment) => segment.length > 0);
  } catch {
    return '';
  }
  const name = segments[1] ?? '';
  return name.endsWith('.git') ? name.slice(0, -4) : name;
}
