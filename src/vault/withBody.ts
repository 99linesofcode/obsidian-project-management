// Replaces a note's body, keeping its frontmatter block verbatim. A note with
// no frontmatter block is replaced entirely by the new body.
export function withBody(content: string, body: string): string {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return body;
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    return body;
  }
  return [...lines.slice(0, closing + 1), ...body.split('\n')].join('\n');
}
