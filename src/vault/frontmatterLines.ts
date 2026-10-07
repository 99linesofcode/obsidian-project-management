// The lines between a note's frontmatter delimiters, or null when the note has
// no frontmatter block. The one splitter every frontmatter reader shares.
export function frontmatterLines(content: string): string[] | null {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return null;
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    return null;
  }
  return lines.slice(1, closing);
}
