import { describe, expect, it } from 'vitest';
import { GithubTaskMapper } from '../../../src/Domain/Mappers/GithubTaskMapper.js';
import type { BoardItemData } from '../../../src/Domain/DataTransferObjects/BoardItemData.js';
import type { GithubTaskData } from '../../../src/Domain/DataTransferObjects/GithubTaskData.js';

const issue: GithubTaskData = {
  url: 'https://github.com/acme/widgets/issues/42',
  remoteId: 42,
  nodeId: 'I_kwDOAAAA42',
  title: 'Fix the bug',
  body: 'The bug happens on resize.',
  state: 'open',
  updatedAt: '2026-09-18T10:00:00Z',
  labels: ['type: task'],
};

const card: BoardItemData = {
  itemId: 'PVTI_1',
  type: 'ISSUE',
  issueUrl: issue.url,
  statusOptionName: 'Building',
};

describe('GithubTaskMapper', () => {
  it('parses an issue and its card onto the canonical task', () => {
    // Given — an issue and its board card

    // When — the pair is parsed
    const task = GithubTaskMapper.parse(issue, card);

    // Then — identity and content are carried, the lane comes from the card
    expect(task.url).toBe(issue.url);
    expect(task.remoteId).toBe(42);
    expect(task.nodeId).toBe('I_kwDOAAAA42');
    expect(task.title).toBe('Fix the bug');
    expect(task.body).toBe('The bug happens on resize.');
    expect(task.status).toBe('Building');
    expect(task.completed).toBe(false);
    expect(task.parent).toBeNull();
    expect(task.labels).toEqual(['type: task']);
  });

  it('parses a card-less issue with no lane', () => {
    // Given — an issue with no board card

    // When — the issue is parsed
    const task = GithubTaskMapper.parse(issue, null);

    // Then — the lane is empty
    expect(task.status).toBe('');
  });

  it('reads a closed issue as completed', () => {
    // Given — a closed issue

    // When — the issue is parsed
    const task = GithubTaskMapper.parse({ ...issue, state: 'closed' }, card);

    // Then — the canonical task is completed
    expect(task.completed).toBe(true);
  });

  it('round-trips the issue fields and lane through render', () => {
    // Given — a canonical task parsed from an issue and card
    const task = GithubTaskMapper.parse(issue, card);

    // When — it is rendered back
    const rendered = GithubTaskMapper.render(task);

    // Then — the issue fields and lane are recovered
    expect(rendered).toEqual({
      title: 'Fix the bug',
      body: 'The bug happens on resize.',
      state: 'open',
      status: 'Building',
    });
  });

  it('renders a completed task as a closed issue', () => {
    // Given — a completed canonical task
    const task = { ...GithubTaskMapper.parse(issue, card), completed: true };

    // When — it is rendered
    const rendered = GithubTaskMapper.render(task);

    // Then — the issue state is closed
    expect(rendered.state).toBe('closed');
  });

  it('renders an empty lane as no status', () => {
    // Given — a canonical task with no lane
    const task = GithubTaskMapper.parse(issue, null);

    // When — it is rendered
    const rendered = GithubTaskMapper.render(task);

    // Then — the status is null
    expect(rendered.status).toBeNull();
  });
});
