import { describe, expect, it } from 'vitest';
import { GithubTaskMapper } from '../../src/github/GithubTaskMapper.js';
import type { BoardItemData } from '../../src/shared/BoardItemData.js';
import type { GithubTaskData } from '../../src/github/GithubTaskData.js';

const DONE_LANE = 'Shipped';

const issue: GithubTaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the bug',
  body: 'The bug happens on resize.',
  state: 'open',
  createdAt: '2026-09-18T09:00:00Z',
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

describe('MAT-3 — only typed issues are adopted', () => {
  it('parses an issue and its card onto the canonical task', () => {
    const task = GithubTaskMapper.parse(issue, card, DONE_LANE);

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
    const task = GithubTaskMapper.parse(issue, card, DONE_LANE);

    expect(task.updatedAt).toBe('2026-09-18T10:00:00Z');
  });

  it('parses a card-less issue with no lane', () => {
    const task = GithubTaskMapper.parse(issue, null, DONE_LANE);

    expect(task.status).toBe('');
    expect(task.completedAt).toBeNull();
  });

  it('stamps a done-lane issue as completed (the invariant)', () => {
    const task = GithubTaskMapper.parse(
      issue,
      { ...card, statusOptionName: DONE_LANE },
      DONE_LANE,
    );

    expect(task.completedAt).toBe('');
  });

  it('reads the vault-owned type from the type label', () => {
    const task = GithubTaskMapper.parse(
      { ...issue, labels: ['type:bug'] },
      card,
      DONE_LANE,
    );

    expect(task.type).toBe('bug');
  });
});
