export function projectFromNotePath(path: string): string {
  const segments = path.split('/');
  if (segments[0] !== 'Projecten' && segments[0] !== 'Archief') {
    return '';
  }
  return segments[1] ?? '';
}

export function projectNameFromPath(path: string): string | null {
  const segments = path.split('/');
  if (segments[0] !== 'Projecten' && segments[0] !== 'Archief') {
    return null;
  }
  if (segments.length !== 3) {
    return null;
  }
  return segments[1] ?? null;
}

export function archivedFromPath(path: string): boolean {
  return path.startsWith('Archief/');
}

export function projectPathWithName(path: string, projectName: string): string {
  const segments = path.split('/');
  if (segments[0] !== 'Projecten' && segments[0] !== 'Archief') {
    return path;
  }
  if (segments.length < 2) {
    return path;
  }
  segments[1] = projectName;
  return segments.join('/');
}

export function projectHomeStem(projectName: string): string {
  return `_${projectName}`;
}

export function projectHomePath(
  projectName: string,
  archived: boolean,
): string {
  const root = archived ? 'Archief' : 'Projecten';
  return `${root}/${projectName}/${projectHomeStem(projectName)}.md`;
}

export function chooseHomeNotePath(
  paths: readonly string[],
  projectName: string,
): string | null {
  const conventionalStem = `${projectHomeStem(projectName)}.md`;
  const conventional = paths.find(
    (path) => path.split('/').pop() === conventionalStem,
  );
  return conventional ?? paths[0] ?? null;
}

export function folderChainForPath(path: string): string[] {
  const folderSegments = path.split('/').slice(0, -1);

  const folders: string[] = [];
  let acc = '';
  for (const segment of folderSegments) {
    acc = acc ? `${acc}/${segment}` : segment;
    folders.push(acc);
  }
  return folders;
}

export interface FreePathVault {
  getNoteByPath(path: string): Promise<{ content: string } | null>;
}

export async function freePath(
  vault: FreePathVault,
  base: string,
): Promise<string> {
  if (!(await vault.getNoteByPath(base))) {
    return base;
  }
  const stem = base.replace(/\.md$/, '');
  let suffix = 2;
  while (await vault.getNoteByPath(`${stem}-${suffix}.md`)) {
    suffix++;
  }
  return `${stem}-${suffix}.md`;
}
