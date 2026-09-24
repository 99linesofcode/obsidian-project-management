import { describe, expect, it } from 'vitest';
import { PushNoteAction } from '../../../src/Domain/Actions/PushNoteAction.js';
import type { TaskData } from '../../../src/Domain/DataTransferObjects/TaskData.js';
import type { ProjectManagementPort } from '../../../src/Domain/Ports/ProjectManagementPort.js';

// A fake at the port: records the update the action asks for and returns a
// canned updated task, so the action's own behaviour (PATCH + return) is
// what's under test.
class FakeProjectManagement implements ProjectManagementPort {
  async setProjectClosed(): Promise<void> {}
  async lockIssue(): Promise<void> {}
  async fetchProjectStates(): Promise<never> {
    throw new Error('not used in this test');
  }
  updateCalls: Array<{ url: string; input: { title: string; body: string } }> =
    [];
  updated: TaskData = {
    url: 'https://github.com/acme/widgets/issues/42',
    remoteId: 42,
    nodeId: 'I_kwDOAAAA42',
    title: 'fix the widget',
    body: 'The bug now also happens on resize.',
    state: 'open',
    updatedAt: '2026-09-18T12:30:00Z',
    labels: [],
  };

  async fetchProjectIdentity(): Promise<null> {
    return null;
  }

  async fetchTrackedIssues(): Promise<TaskData[]> {
    return [];
  }

  async fetchTask(): Promise<TaskData> {
    throw new Error('not used in this test');
  }

  async updateTask(
    url: string,
    input: { title: string; body: string },
  ): Promise<TaskData> {
    this.updateCalls.push({ url, input });
    return this.updated;
  }

  async setTaskState(): Promise<TaskData> {
    throw new Error('not used in this test');
  }

  async fetchBoardItems(): Promise<never> {
    throw new Error('not used in this test');
  }

  async setBoardStatus(): Promise<void> {
    throw new Error('not used in this test');
  }

  async addBoardItem(): Promise<void> {
    throw new Error('not used in this test');
  }

  async fetchUnpromotedIssues(): Promise<never> {
    throw new Error('not used in this test');
  }

  async addLabel(): Promise<void> {
    throw new Error('not used in this test');
  }

  async promoteCard(): Promise<never> {
    throw new Error('not used in this test');
  }
}

describe('PushNoteAction', () => {
  it('pushes the title and body onto the issue and returns the updated task', async () => {
    // Given — a port that returns the updated issue
    const port = new FakeProjectManagement();
    const action = new PushNoteAction(port);

    // When — the note is pushed
    const result = await action.execute({
      url: 'https://github.com/acme/widgets/issues/42',
      title: 'fix the widget',
      body: 'The bug now also happens on resize.',
    });

    // Then — the port was asked to update the issue with the title and body
    expect(port.updateCalls).toEqual([
      {
        url: 'https://github.com/acme/widgets/issues/42',
        input: {
          title: 'fix the widget',
          body: 'The bug now also happens on resize.',
        },
      },
    ]);
    // And the updated task is returned for the caller to refresh its baseline
    expect(result).toBe(port.updated);
  });

  it('strips checklist wikilinks before pushing the body', async () => {
    // Given — a note body whose checklist items link to vault to-dos
    const port = new FakeProjectManagement();
    const action = new PushNoteAction(port);

    // When — the note is pushed
    await action.execute({
      url: 'https://github.com/acme/widgets/issues/42',
      title: 'fix the widget',
      body: [
        'Intro',
        '- [ ] [[Projecten/Acme Widgets/todos/fix-the-bug.md|Fix the bug]]',
        '- [x] Plain',
      ].join('\n'),
    });

    // Then — the issue receives the checklist without the vault-only links
    expect(port.updateCalls).toEqual([
      {
        url: 'https://github.com/acme/widgets/issues/42',
        input: {
          title: 'fix the widget',
          body: ['Intro', '- [ ] Fix the bug', '- [x] Plain'].join('\n'),
        },
      },
    ]);
  });
});
