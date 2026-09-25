// A wikilink's target: the `[[...]]` delimiters and any `|display` alias are
// stripped, and the result trimmed. Shared by every affiliation reader.
export function stripLink(link: string): string {
  return link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.trim();
}
