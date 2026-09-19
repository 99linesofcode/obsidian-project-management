// The ordered list of folder paths that must exist for a note path, from the
// vault root down. Obsidian's createFolder only makes one level, so the
// adapter walks this list in order to build the chain (mkdir -p semantics).
export function folderChainForPath(path: string): string[] {
  const segments = path.split('/');
  segments.pop(); // the filename

  const folders: string[] = [];
  let acc = '';
  for (const segment of segments) {
    acc = acc ? `${acc}/${segment}` : segment;
    folders.push(acc);
  }
  return folders;
}
