import { warnOnExtraTypeLabels } from '../../core/application/typeLabelWarnings.js';
import type { CanonicalField } from '../../core/domain/canonicalField.js';
import { CanonicalTask } from '../../core/port/data/CanonicalTask.js';
import type { RawCard, RawIssue } from './githubWire.js';

export function toCanonicalTask(
  issue: RawIssue,
  card: RawCard | null,
): CanonicalTask {
  warnOnExtraTypeLabels(issue.labels);
  return new CanonicalTask({
    handle: issue.url,
    entityId: issue.url,
    title: issue.title,
    body: issue.body,
    status: card?.statusOptionName ?? '',
    completed: issue.state === 'closed',
    parent: issue.parentUrl,
    labels: issue.labels,
  });
}

export function fieldTime(
  issue: RawIssue,
  card: RawCard | null,
  field: CanonicalField,
): string | null {
  switch (field) {
    case 'title':
    case 'body':
      return issue.lastEditedAt;
    case 'Status':
      return card?.updatedAt ?? null;
    case 'completion':
    case 'label':
    case 'subtasks':
      return issue.updatedAt === '' ? null : issue.updatedAt;
  }
}
