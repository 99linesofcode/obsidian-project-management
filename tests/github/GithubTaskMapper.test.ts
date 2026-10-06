import { describe, expect, it } from 'vitest';
import { GithubTaskMapper } from '../../src/github/GithubTaskMapper.js';
import type { BoardItemData } from '../../src/projects/BoardItemData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';

const DONE_LANE = 'Shipped';

const issue: GithubTaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the bug',
  body: 'The bug happens on resize.',
  state: 'open',
  createdAt: '2026-09-18T09:00:00Z',
  // The comment-noisy updatedAt is deliberately later than lastEditedAt, so a
  // mapper that reads the wrong clock is caught.
  lastEditedAt: '2026-09-18T10:00:00Z',
  updatedAt: '2026-09-18T11:30:00Z',
  labels: ['type: task'],
  parentUrl: null,
};

const card: BoardItemData = {
  itemId: 'PVTI_1',
  type: 'ISSUE',
  issueUrl: issue.url,
  statusOptionName: 'Building',
  updatedAt: null,
};

describe('GithubTaskMapper', () => {
  it('parses an issue and its card onto the canonical task', () => {
    // Given — an issue and its board card

    // When — the pair is parsed
    const task = GithubTaskMapper.parse(issue, card, DONE_LANE);

    // Then — identity is empty (the half composes it from the registry), the
    // content is carried, the lane comes from the card, and the type comes from
    // the label
    expect(task.id).toBe('');
    expect(task.notePath).toBe('');
    expect(task.mirrors).toEqual({ github: issue.url });
    expect(task.title).toBe('Fix the bug');
    expect(task.body).toBe('The bug happens on resize.');
    expect(task.status).toBe('Building');
    expect(task.completedAt).toBeNull();
    expect(task.type).toBe('task');
    expect(task.parent).toBeNull();
    expect(task.createdAt).toBe('2026-09-18T09:00:00Z');
  });

  it('uses lastEditedAt as the content clock, not the comment-noisy updatedAt', () => {
    // Given — an issue whose updatedAt (a comment) postdates its last edit

    // When — the issue is parsed
    const task = GithubTaskMapper.parse(issue, card, DONE_LANE);

    // Then — the canonical clock is the edit, never the comment
    expect(task.updatedAt).toBe('2026-09-18T10:00:00Z');
  });

  it('parses a card-less issue with no lane', () => {
    // Given — an issue with no board card

    // When — the issue is parsed
    const task = GithubTaskMapper.parse(issue, null, DONE_LANE);

    // Then — the lane is empty and no completion is derived
    expect(task.status).toBe('');
    expect(task.completedAt).toBeNull();
  });

  it('stamps a done-lane issue as completed (the invariant)', () => {
    // Given — a card in the project's done lane

    // When — the issue is parsed
    const task = GithubTaskMapper.parse(
      issue,
      { ...card, statusOptionName: DONE_LANE },
      DONE_LANE,
    );

    // Then — completedAt is non-null ('' = done, stamp unknown)
    expect(task.completedAt).toBe('');
  });

  it('reads the vault-owned type from the type label', () => {
    // Given — an issue carrying a legacy no-space type label

    // When — the issue is parsed
    const task = GithubTaskMapper.parse(
      { ...issue, labels: ['type:bug'] },
      card,
      DONE_LANE,
    );

    // Then — the type is stripped and trimmed
    expect(task.type).toBe('bug');
  });
});
