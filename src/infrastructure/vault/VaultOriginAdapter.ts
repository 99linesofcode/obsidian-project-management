import { TFile } from 'obsidian';
import type { App } from 'obsidian';
import type { CanonicalField } from '../../core/canonicalField.js';
import type { CanonicalFieldWrite } from '../../core/data/CanonicalFieldWrite.js';
import { OriginObservation } from '../../core/data/OriginObservation.js';
import type { OriginPort } from '../../core/ports/OriginPort.js';

interface TaskNote {
  title: string;
  status: string;
  body: string;
  completed: boolean;
  parent: string | null;
  labels: readonly string[];
}

export class VaultOriginAdapter implements OriginPort {
  constructor(private readonly app: App) {}

  async observe(
    handle: string,
    field: CanonicalField,
  ): Promise<OriginObservation> {
    const file = this.app.vault.getAbstractFileByPath(handle);
    if (!(file instanceof TFile)) {
      return new OriginObservation({
        current: null,
        currentCompleted: false,
        fieldTime: null,
        trustworthy: true,
      });
    }

    const note = parseTaskNote(await this.app.vault.read(file), handle);
    return new OriginObservation({
      current: fieldValue(note, field),
      currentCompleted: note.completed,
      fieldTime: new Date(file.stat.mtime).toISOString(),
      trustworthy: true,
    });
  }

  async applyField(write: CanonicalFieldWrite): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(write.handle);
    if (!(file instanceof TFile)) {
      throw new Error(`origin note not found: ${write.handle}`);
    }

    if (write.field === 'title') {
      await this.rename(file, write.value);
      return;
    }

    const content = await this.app.vault.read(file);
    const updated = writeIntoNote(content, write);
    if (updated === content) {
      throw new Error(
        `origin note cannot accept ${write.field}: ${write.handle}`,
      );
    }
    await this.app.vault.modify(file, updated);
  }

  async trash(handle: string): Promise<void> {
    const file = this.app.vault.getAbstractFileByPath(handle);
    if (file instanceof TFile) {
      await this.app.fileManager.trashFile(file);
    }
  }

  private async rename(file: TFile, title: string | null): Promise<void> {
    if (title === null) {
      return;
    }
    const slug = slugify(title);
    if (slug === '') {
      throw new Error(`origin note has no usable title: ${file.path}`);
    }
    const folder = folderOf(file.path);
    await this.app.fileManager.renameFile(
      file,
      folder === null ? `${slug}.md` : `${folder}/${slug}.md`,
    );
  }
}

function parseTaskNote(content: string, handle: string): TaskNote {
  const fields = frontmatterFields(content);
  return {
    title: titleFromPath(handle),
    status: fields.get('status') ?? '',
    body: bodyOf(content),
    completed: (fields.get('completed') ?? '') !== '',
    parent: parentFromAffiliation(fields.get('affiliation')),
    labels: labelsFrom(fields.get('labels')),
  };
}

function fieldValue(note: TaskNote, field: CanonicalField): string | null {
  switch (field) {
    case 'title':
      return note.title;
    case 'body':
      return note.body;
    case 'Status':
      return note.status;
    case 'completion':
      return note.completed ? 'true' : 'false';
    case 'subtasks':
      return note.parent;
    case 'label':
      return note.labels.join(',');
    case 'identity':
      return null;
  }
}

function writeIntoNote(content: string, write: CanonicalFieldWrite): string {
  switch (write.field) {
    case 'body':
      return withBody(content, write.value ?? '');
    case 'Status':
      return withFrontmatter(content, 'status', write.value);
    case 'completion':
      return withFrontmatter(
        content,
        'completed',
        write.value === 'true' ? 'true' : null,
      );
    case 'label':
      return withFrontmatter(content, 'labels', write.value);
    case 'subtasks':
      return withParent(content, write.value);
    case 'title':
    case 'identity':
      return content;
  }
}

function frontmatterFields(content: string): Map<string, string> {
  const lines = content.split('\n');
  const fields = new Map<string, string>();
  if (lines[0] !== '---') {
    return fields;
  }
  for (let i = 1; i < lines.length && lines[i] !== '---'; i++) {
    const line = lines[i]!;
    const colon = line.indexOf(':');
    if (colon > 0) {
      fields.set(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
    }
  }
  return fields;
}

function bodyOf(content: string): string {
  const lines = content.split('\n');
  if (lines[0] !== '---') {
    return content;
  }
  const closing = lines.indexOf('---', 1);
  if (closing === -1) {
    return content;
  }
  return lines.slice(closing + 1).join('\n');
}

function titleFromPath(handle: string): string {
  const basename = handle.split('/').pop() ?? '';
  const stem = basename.replace(/\.md$/, '').replace(/^\d+-/, '');
  return stem.replace(/-/g, ' ');
}

function parentFromAffiliation(raw: string | undefined): string | null {
  if (raw === undefined) {
    return null;
  }
  const links = quotedLinks(raw);
  const parent = links[1];
  return parent === undefined ? null : stripLink(parent);
}

function labelsFrom(raw: string | undefined): readonly string[] {
  if (raw === undefined || raw === '') {
    return [];
  }
  return raw
    .split(',')
    .map((label) => label.trim())
    .filter((label) => label !== '');
}

function quotedLinks(raw: string): string[] {
  return [...raw.matchAll(/"([^"]*)"/g)].map((match) => match[1]!);
}

function stripLink(link: string): string {
  return link.replace(/^\[\[/, '').replace(/\]\]$/, '').split('|')[0]!.trim();
}

function withBody(content: string, body: string): string {
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

function withFrontmatter(
  content: string,
  key: string,
  value: string | null,
): string {
  const lines = content.split('\n');
  const closing = lines[0] === '---' ? lines.indexOf('---', 1) : -1;
  if (closing === -1) {
    return content;
  }

  for (let i = 1; i < closing; i++) {
    if (lines[i]!.startsWith(`${key}:`)) {
      lines[i] = renderLine(key, value);
      return lines.join('\n');
    }
  }

  lines.splice(closing, 0, renderLine(key, value));
  return lines.join('\n');
}

function withParent(content: string, parent: string | null): string {
  const raw = frontmatterFields(content).get('affiliation');
  if (raw === undefined) {
    return content;
  }
  const links = quotedLinks(raw);
  const project = links[0];
  if (project === undefined) {
    return content;
  }

  const next = parent === null ? [project] : [project, `[[${parent}]]`];
  const value = `[${next.map((link) => `"${link}"`).join(', ')}]`;
  return withFrontmatter(content, 'affiliation', value);
}

function renderLine(key: string, value: string | null): string {
  return value === null ? `${key}:` : `${key}: ${value}`;
}

function folderOf(path: string): string | null {
  const slash = path.lastIndexOf('/');
  return slash === -1 ? null : path.slice(0, slash);
}

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}
