#!/usr/bin/env node
// Live probe for the sync RESTRUCTURE (t8). The vitest fakes prove the logic;
// this script proves the integration of the new surfaces against the REAL
// GitHub and Todoist APIs.
//
// It is deliberately NOT wired into vitest or CI — it needs personal tokens and
// touches the network.
//
// Safety / cleanup:
//   - It creates ONE scratch Todoist project (plus a probe label) and ONE
//     scratch GitHub ProjectV2 board, and deletes both in a finally block.
//   - It reads the plugin's own repository but NEVER writes to it. The only
//     GitHub writes are card moves / project close on the scratch board, which
//     is deleted with the board.
//   - The token lacks the `delete_repo` scope, so no scratch repo is created
//     (see the t8 log): the board is the deletable GitHub scratch surface.
//
// Run: node --experimental-transform-types scripts/restructure-probe.mjs
import { readFileSync } from 'node:fs';
import { GitHubAdapter } from '../src/Infrastructure/GitHub/GitHubAdapter.ts';
import {
  TodoistAdapter,
  createTodoistTransport,
} from '../src/Infrastructure/Todoist/TodoistAdapter.ts';
import { ApplyTaskToGithubAction } from '../src/Domain/Actions/ApplyTaskToGithubAction.ts';
import { ApplyTaskToTodoistAction } from '../src/Domain/Actions/ApplyTaskToTodoistAction.ts';
import { ApplyTodoistRemoteChangesAction } from '../src/Domain/Actions/ApplyTodoistRemoteChangesAction.ts';
import { ReconcileProjectLifecycleAction } from '../src/Domain/Actions/ReconcileProjectLifecycleAction.ts';
import { GithubTaskMapper } from '../src/Domain/Mappers/GithubTaskMapper.ts';

const GITHUB_TOKEN_PATH = '/home/shorty/.config/sops-nix/secrets/github_token';
const TODOIST_TOKEN_PATH =
  '/home/shorty/.config/sops-nix/secrets/todoist_api_key';

// The scratch board attaches to the plugin's own repo (read-only for the repo).
const PROBE_REPO =
  'https://github.com/99linesofcode/obsidian-project-management';
const PROBE_REPO_OWNER = '99linesofcode';
const PROBE_REPO_NAME = 'obsidian-project-management';
const PROBE_LOGIN = '99linesofcode';
const SCRATCH_PROJECT = 'OPM restructure probe';
const PROBE_LABEL = 'opm-restructure-probe';
const DONE_LANE = 'Done';

const results = [];
let todoistCalls = 0;
let githubCalls = 0;
let todoistCallsTotal = 0;
let githubCallsTotal = 0;
// Every Todoist write (POST/DELETE), so a settle pass can assert zero writes.
const todoistWriteLog = [];

function record(step, outcome, detail) {
  results.push({ step, outcome, detail });
  const suffix = detail === undefined ? '' : ` — ${detail}`;
  console.log(`[${outcome}] ${step}${suffix}`);
}

async function run(step, fn) {
  try {
    const value = await fn();
    record(step, 'ok', value === undefined ? undefined : String(value));
    return value;
  } catch (error) {
    record(
      step,
      'FAIL',
      error instanceof Error ? error.message : String(error),
    );
    return undefined;
  }
}

function readToken(path) {
  return readFileSync(path, 'utf8').trim();
}

// --- GitHub transport (token-bound, mirrors main.ts) ------------------------

function createGithubTransport(token) {
  const rest = async (method, path, body, etag) => {
    githubCalls += 1;
    githubCallsTotal += 1;
    const headers = { Authorization: `Bearer ${token}` };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (etag !== undefined) headers['If-None-Match'] = etag;
    const response = await fetch(`https://api.github.com${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body }),
    });
    const text = await response.text();
    const json = text.length > 0 ? JSON.parse(text) : null;
    const responseEtag = response.headers.get('etag');
    return {
      status: response.status,
      json,
      ...(responseEtag === null ? {} : { etag: responseEtag }),
    };
  };
  const graphql = async (body) => {
    githubCalls += 1;
    githubCallsTotal += 1;
    const response = await fetch('https://api.github.com/graphql', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body,
    });
    const text = await response.text();
    return {
      status: response.status,
      json: text.length > 0 ? JSON.parse(text) : null,
    };
  };
  return {
    post: (body) => graphql(body),
    get: (path) => rest('GET', path),
    getConditional: (path, etag) => rest('GET', path, undefined, etag),
    patch: (path, body) => rest('PATCH', path, body),
    postPath: (path, body) => rest('POST', path, body),
  };
}

async function githubGraphql(token, query, variables) {
  githubCalls += 1;
  githubCallsTotal += 1;
  const response = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await response.json();
  if (json.errors) {
    throw new Error(JSON.stringify(json.errors));
  }
  return json.data;
}

// --- Todoist transport (token-bound, counted) --------------------------------

function createCountingTodoistTransport(token) {
  const inner = createTodoistTransport(token);
  const wrap =
    (method, call) =>
    async (...args) => {
      todoistCalls += 1;
      todoistCallsTotal += 1;
      if (method !== 'GET') {
        todoistWriteLog.push(`${method} ${args[0]}`);
      }
      return call(...args);
    };
  return {
    get: wrap('GET', inner.get),
    post: wrap('POST', inner.post),
    delete: wrap('DELETE', inner.delete),
  };
}

// --- In-memory ports ---------------------------------------------------------

class MemorySyncState {
  statuses = new Map();
  todoistStates = new Map();
  identities = new Map();
  lastUpdates = new Map();
  baselines = new Map();
  watches = new Map();
  todoistProjects = new Map();

  async get(url) {
    return this.statuses.get(url) ?? null;
  }
  async set(record) {
    this.statuses.set(record.url, record);
  }
  async findByNotePath(notePath) {
    for (const record of this.statuses.values()) {
      if (record.notePath === notePath) return record;
    }
    return null;
  }
  async remove(url) {
    this.statuses.delete(url);
  }
  async list() {
    return [...this.statuses.values()];
  }
  async setIdentity(projectName, identity) {
    this.identities.set(projectName, identity);
  }
  async getIdentity(projectName) {
    return this.identities.get(projectName) ?? null;
  }
  async getLastProjectUpdate(projectName) {
    return this.lastUpdates.get(projectName) ?? null;
  }
  async setLastProjectUpdate(projectName, iso) {
    this.lastUpdates.set(projectName, iso);
  }
  async getArchiveBaseline(projectName) {
    return this.baselines.get(projectName) ?? null;
  }
  async setArchiveBaseline(projectName, baseline) {
    this.baselines.set(projectName, baseline);
  }
  async getWatchState() {
    return { etag: null, cursor: null };
  }
  async setWatchState() {}
  async getTodoistProjectState(projectName) {
    return this.todoistProjects.get(projectName) ?? null;
  }
  async setTodoistProjectState(projectName, state) {
    this.todoistProjects.set(projectName, state);
  }
  async getTodoistState(notePath) {
    return this.todoistStates.get(notePath) ?? null;
  }
  async setTodoistState(notePath, state) {
    if (state.todoistId !== '') {
      for (const [key, value] of this.todoistStates) {
        if (key !== notePath && value.todoistId === state.todoistId) {
          this.todoistStates.delete(key);
        }
      }
    }
    this.todoistStates.set(notePath, state);
  }
  async removeTodoistState(notePath) {
    this.todoistStates.delete(notePath);
  }
  async listTodoistStates() {
    return [...this.todoistStates.values()];
  }
}

class MemoryVault {
  notes = new Map();
  projectNotes = [];
  writes = [];

  async getNoteByPath(path) {
    const content = this.notes.get(path);
    return content === undefined ? null : { content };
  }
  async createNote(path, content) {
    this.notes.set(path, content);
  }
  async writeNote(path, content) {
    this.writes.push(path);
    this.notes.set(path, content);
  }
  async renameNote(oldPath, newPath) {
    const content = this.notes.get(oldPath);
    if (content !== undefined) {
      this.notes.delete(oldPath);
      this.notes.set(newPath, content);
    }
  }
  async moveFolder(from, to) {
    for (const [path, content] of [...this.notes]) {
      if (path.startsWith(`${from}/`)) {
        this.notes.delete(path);
        this.notes.set(`${to}/${path.slice(from.length + 1)}`, content);
      }
    }
    for (const note of this.projectNotes) {
      if (note.path.startsWith(`${from}/`)) {
        note.path = `${to}/${note.path.slice(from.length + 1)}`;
      }
    }
  }
  async listNotesInFolder(folder) {
    const prefix = `${folder}/`;
    return [...this.notes.keys()].filter((path) => path.startsWith(prefix));
  }
  async trashNote(path) {
    this.notes.delete(path);
  }
  async findProjectNotes() {
    return this.projectNotes;
  }
  onNoteChanged() {}
  onNoteDeleted() {}
  onNoteRenamed() {}
}

function vaultNote(status, affiliation) {
  return [
    '---',
    `status: ${status}`,
    `affiliation: [${affiliation.map((l) => `"${l}"`).join(', ')}]`,
    '---',
    '',
  ].join('\n');
}

function canonical(overrides) {
  return {
    url: '',
    remoteId: 0,
    nodeId: '',
    todoistId: '',
    notePath: '',
    title: '',
    body: '',
    status: '',
    completed: false,
    parent: null,
    labels: [],
    updatedAt: '',
    ...overrides,
  };
}

const noopAction = { execute: async () => {} };

async function main() {
  const githubToken = readToken(GITHUB_TOKEN_PATH);
  const todoistToken = readToken(TODOIST_TOKEN_PATH);
  const transport = createGithubTransport(githubToken);
  const github = new GitHubAdapter(transport);
  const todoist = new TodoistAdapter(
    createCountingTodoistTransport(todoistToken),
  );

  const syncedAt = new Date().toISOString();
  let projectId;
  let sectionId;
  let projectNodeId;
  let boardNumber;

  try {
    // --- Setup -----------------------------------------------------------
    const scratchProject = await run(
      'setup: create scratch Todoist project',
      () => todoist.createProject(SCRATCH_PROJECT),
    );
    projectId = scratchProject?.id;
    await run('setup: create scratch lane section', async () => {
      const section = await todoist.createSection(projectId, DONE_LANE);
      sectionId = section.id;
      return section.id;
    });

    const repoNodeId = await run('setup: resolve repo node id', async () => {
      const data = await githubGraphql(
        githubToken,
        `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }`,
        { owner: PROBE_REPO_OWNER, name: PROBE_REPO_NAME },
      );
      return data.repository.id;
    });

    const viewerId = await run('setup: resolve viewer id', async () => {
      const data = await githubGraphql(githubToken, 'query { viewer { id } }');
      return data.viewer.id;
    });

    const created = await run(
      'setup: create scratch GitHub board',
      async () => {
        const data = await githubGraphql(
          githubToken,
          `mutation($ownerId: ID!, $title: String!) {
           createProjectV2(input: { ownerId: $ownerId, title: $title }) {
             projectV2 { id number }
           }
         }`,
          { ownerId: viewerId, title: `${SCRATCH_PROJECT} ${Date.now()}` },
        );
        return data.createProjectV2.projectV2;
      },
    );
    projectNodeId = created?.id;
    boardNumber = created?.number;

    const identity = await run('setup: attach the board', () =>
      github.fetchProjectIdentity({
        repoUrl: PROBE_REPO,
        boardUrl: `https://github.com/users/${PROBE_LOGIN}/projects/${boardNumber}`,
      }),
    );
    if (!identity) throw new Error('board attach returned null');
    record(
      'setup: identity resolved',
      'ok',
      `repoNodeId=${repoNodeId === identity.repoNodeId ? 'match' : 'MISMATCH'} lanes=${identity.statusOptions.map((o) => o.name).join('/')}`,
    );

    // --- 1. Single-query project detail fetch -----------------------------
    await run(
      'detail: single-query fetch returns issues with bodies',
      async () => {
        githubCalls = 0;
        const detail = await github.fetchProjectDetail(
          PROBE_REPO,
          projectNodeId,
        );
        const withBody = detail.issues.filter((issue) => issue.body !== '');
        if (detail.issues.length === 0) {
          throw new Error('no typed issues in the repo');
        }
        if (withBody.length === 0) {
          throw new Error('typed issues carried no bodies');
        }
        return `${detail.issues.length} issues (${withBody.length} with bodies), ${detail.cards.length} cards in ${githubCalls} request(s)`;
      },
    );
    const issue = (
      await github.fetchProjectDetail(PROBE_REPO, projectNodeId)
    ).issues.find(
      (candidate) => candidate.body !== '' && candidate.state === 'open',
    );
    if (!issue) throw new Error('no open typed issue with a body to place');

    // --- 2. GitHub writer field gate --------------------------------------
    await run('writer: place the issue on the scratch board', async () => {
      await github.addBoardItem(projectNodeId, issue.url);
      // ProjectsV2 reads are eventually consistent: a freshly added card can
      // take tens of seconds to appear (and to resolve its issue url). Poll
      // with a generous budget before placing it in a lane.
      let card;
      for (let attempt = 0; attempt < 90 && !card; attempt++) {
        const items = await github.fetchBoardItems(projectNodeId);
        card = items.find((candidate) => candidate.issueUrl === issue.url);
        if (!card) await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!card) throw new Error('added card never appeared on the board');
      const lane = identity.statusOptions[0];
      await github.setBoardStatus(
        projectNodeId,
        identity.statusFieldId,
        issue.url,
        lane.id,
      );
      return `lane ${lane.name} (card ${card.itemId})`;
    });

    const nonDone = identity.statusOptions.filter((o) => o.name !== DONE_LANE);
    const laneB = nonDone[1] ?? nonDone[0];

    const githubState = new MemorySyncState();
    await githubState.setIdentity(SCRATCH_PROJECT, identity);
    const githubWriter = new ApplyTaskToGithubAction(github, githubState);

    const readRemote = async (expectedStatus) => {
      for (let attempt = 0; attempt < 60; attempt++) {
        const detail = await github.fetchProjectDetail(
          PROBE_REPO,
          projectNodeId,
        );
        const foundIssue = detail.issues.find((i) => i.url === issue.url);
        const card = detail.cards.find((c) => c.issueUrl === issue.url) ?? null;
        if (!foundIssue) throw new Error('placed issue missing from detail');
        const parsed = GithubTaskMapper.parse(foundIssue, card);
        if (expectedStatus === undefined || parsed.status === expectedStatus) {
          return parsed;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      throw new Error(`lane never reached ${expectedStatus}`);
    };

    await run('writer: writes a differing board lane once', async () => {
      const current = await readRemote();
      const desired = { ...current, status: laneB.name };
      githubCalls = 0;
      await githubWriter.execute({
        task: desired,
        current,
        hasCard: true,
        projectName: SCRATCH_PROJECT,
        syncedAt,
      });
      if (githubCalls === 0) throw new Error('no write for a differing lane');
      const after = await readRemote(laneB.name);
      return `wrote in ${githubCalls} request(s), lane now ${after.status}`;
    });

    await run('writer: re-run performs no second write', async () => {
      const current = await readRemote(laneB.name);
      githubCalls = 0;
      await githubWriter.execute({
        task: { ...current },
        current,
        hasCard: true,
        projectName: SCRATCH_PROJECT,
        syncedAt,
      });
      if (githubCalls !== 0) {
        throw new Error(`second write: ${githubCalls} request(s)`);
      }
      return `settled at ${current.status}, 0 requests`;
    });

    // --- 3. Todoist writer field gate -------------------------------------
    const writerVault = new MemoryVault();
    const writerState = new MemorySyncState();
    const writer = new ApplyTaskToTodoistAction(
      todoist,
      writerVault,
      writerState,
    );
    const gateNote = `Projecten/${SCRATCH_PROJECT}/taken/probe-gate-task.md`;
    writerVault.notes.set(gateNote, vaultNote('Building', []));

    let gateTwinId;
    await run('todoist writer: creates a twin once', async () => {
      todoistCalls = 0;
      gateTwinId = await writer.executeTask({
        task: canonical({
          notePath: gateNote,
          title: 'Probe gate task',
          status: DONE_LANE,
          completed: false,
        }),
        current: null,
        projectId,
        sectionId,
        parentId: null,
        labels: ['task'],
        description: '',
        notePath: gateNote,
        noteContent: writerVault.notes.get(gateNote),
        syncedAt,
      });
      if (todoistCalls === 0) throw new Error('create made no call');
      return `${gateTwinId} in ${todoistCalls} call(s)`;
    });

    await run('todoist writer: re-run performs no second write', async () => {
      const active = await todoist.fetchActiveTasks(projectId);
      const twin = active.find((t) => t.id === gateTwinId) ?? null;
      if (!twin) throw new Error('created twin not active');
      todoistCalls = 0;
      await writer.executeTask({
        task: canonical({
          notePath: gateNote,
          title: 'Probe gate task',
          status: DONE_LANE,
          completed: false,
        }),
        current: twin,
        projectId,
        sectionId,
        parentId: null,
        labels: ['task'],
        description: '',
        notePath: gateNote,
        noteContent: writerVault.notes.get(gateNote),
        syncedAt,
      });
      if (todoistCalls !== 0) {
        throw new Error(`second write: ${todoistCalls} call(s)`);
      }
      return '0 calls';
    });

    // --- 4. Two-way archive backflow --------------------------------------
    const lifecycleVault = new MemoryVault();
    const lifecycleState = new MemorySyncState();
    const homePath = `Projecten/${SCRATCH_PROJECT}/_home.md`;
    lifecycleVault.notes.set(
      homePath,
      `---\npm: github\ntodoist: ${projectId}\n---\n`,
    );
    lifecycleVault.projectNotes = [
      {
        path: homePath,
        projectName: SCRATCH_PROJECT,
        archived: false,
        pm: 'github',
      },
    ];
    await lifecycleState.setIdentity(SCRATCH_PROJECT, identity);
    await lifecycleState.setArchiveBaseline(SCRATCH_PROJECT, {
      locationArchived: false,
      closed: false,
    });
    const lifecycle = new ReconcileProjectLifecycleAction(
      github,
      todoist,
      lifecycleVault,
      lifecycleState,
      DONE_LANE,
    );

    await run(
      'archive backflow: Todoist archive moves the vault folder',
      async () => {
        await todoist.setProjectArchived(projectId, true);
        const verdict = await lifecycle.execute({
          projectName: SCRATCH_PROJECT,
          notePath: homePath,
          locationArchived: false,
          syncedAt,
          closed: false,
        });
        if (!verdict.frozen || !verdict.locationArchived) {
          throw new Error('verdict did not freeze');
        }
        if (lifecycleVault.notes.has(homePath)) {
          throw new Error('vault folder did not move');
        }
        const moved = `Archief/${SCRATCH_PROJECT}/_home.md`;
        if (!lifecycleVault.notes.has(moved)) {
          throw new Error('archived home note missing');
        }
        return 'folder → Archief';
      },
    );

    await run(
      'archive backflow: unarchive moves it back and reopens the board',
      async () => {
        await todoist.setProjectArchived(projectId, false);
        const archivedHome = `Archief/${SCRATCH_PROJECT}/_home.md`;
        const verdict = await lifecycle.execute({
          projectName: SCRATCH_PROJECT,
          notePath: archivedHome,
          locationArchived: true,
          syncedAt,
          closed: true,
        });
        if (verdict.frozen || verdict.locationArchived) {
          throw new Error('verdict did not reactivate');
        }
        if (!lifecycleVault.notes.has(homePath)) {
          throw new Error('vault folder did not move back');
        }
        const states = await github.fetchProjectStates([projectNodeId]);
        if (states.get(projectNodeId)?.closed === true) {
          throw new Error('board still closed');
        }
        return 'folder → Projecten, board reopened';
      },
    );

    // --- 5. Completion settle over multiple passes ------------------------
    const settleVault = new MemoryVault();
    const settleState = new MemorySyncState();
    const settleNote = `Projecten/${SCRATCH_PROJECT}/taken/probe-settle-task.md`;
    settleVault.notes.set(settleNote, vaultNote('Building', []));
    await settleState.setIdentity(SCRATCH_PROJECT, identity);
    await settleState.setTodoistProjectState(SCRATCH_PROJECT, {
      sections: { [DONE_LANE]: sectionId },
      // A cursor before the completion, so the first pass sees it.
      lastCompletedPoll: new Date(Date.now() - 60_000).toISOString(),
    });
    const settleWriter = new ApplyTaskToTodoistAction(
      todoist,
      settleVault,
      settleState,
    );
    const absorber = new ApplyTodoistRemoteChangesAction(
      todoist,
      settleVault,
      settleState,
      noopAction,
      noopAction,
      noopAction,
      DONE_LANE,
    );

    let settleTwinId;
    await run('settle: create and complete the twin', async () => {
      settleTwinId = await settleWriter.executeTask({
        task: canonical({
          notePath: settleNote,
          title: 'Probe settle task',
          status: 'Building',
          completed: false,
        }),
        current: null,
        projectId,
        sectionId,
        parentId: null,
        labels: ['task'],
        description: '',
        notePath: settleNote,
        noteContent: settleVault.notes.get(settleNote),
        syncedAt,
      });
      await todoist.setTaskCompleted(settleTwinId, true);
      return settleTwinId;
    });

    await run('settle: first absorber pass pulls the completion', async () => {
      await absorber.execute({
        projectName: SCRATCH_PROJECT,
        projectId,
        syncedAt,
      });
      const record = await settleState.getTodoistState(settleNote);
      if (record?.completed !== true) {
        throw new Error('record not stamped completed');
      }
      return 'record completed=true';
    });

    await run(
      'settle: N passes after the window ages produce zero completion writes',
      async () => {
        // Age the cursor past the completion, so the twin is returned by
        // neither the active set nor the completed-since window.
        settleState.todoistProjects.set(SCRATCH_PROJECT, {
          sections: { [DONE_LANE]: sectionId },
          lastCompletedPoll: new Date().toISOString(),
        });

        const problems = [];
        for (let pass = 0; pass < 3; pass++) {
          // The absorber (the completed-since pull) must make no write.
          const beforeAbsorber = todoistWriteLog.length;
          await absorber.execute({
            projectName: SCRATCH_PROJECT,
            projectId,
            syncedAt,
          });
          const absorberWrites = todoistWriteLog.length - beforeAbsorber;

          // The projection (vault done -> twin complete) must make no write.
          const active = await todoist.fetchActiveTasks(projectId);
          const current = active.find((t) => t.id === settleTwinId) ?? null;
          const record = await settleState.getTodoistState(settleNote);
          const beforeProjection = todoistWriteLog.length;
          await settleWriter.executeTask({
            task: canonical({
              notePath: settleNote,
              title: 'Probe settle task',
              status: DONE_LANE,
              completed: true,
            }),
            current,
            projectId,
            sectionId,
            parentId: null,
            labels: ['task'],
            description: '',
            notePath: settleNote,
            noteContent: settleVault.notes.get(settleNote),
            syncedAt,
          });
          const projectionWrites = todoistWriteLog.length - beforeProjection;

          if (absorberWrites + projectionWrites > 0) {
            problems.push(
              `pass ${pass}: ${absorberWrites + projectionWrites} write(s) ${todoistWriteLog.slice(-(absorberWrites + projectionWrites)).join(', ')}`,
            );
          }
          if (record?.completed !== true) {
            problems.push(`pass ${pass}: record lost its completion stamp`);
          }
          if ((await settleState.getTodoistState(settleNote)) === null) {
            problems.push(`pass ${pass}: record evicted`);
          }
        }
        if (problems.length > 0) {
          throw new Error(problems.join('; '));
        }
        return 'record survived 3 passes, 0 completion writes';
      },
    );

    // --- 6. Nesting correctness (dt-22 priority) --------------------------
    const nestVault = new MemoryVault();
    const nestState = new MemorySyncState();
    const nestWriter = new ApplyTaskToTodoistAction(
      todoist,
      nestVault,
      nestState,
    );
    const sliceNote = `Projecten/${SCRATCH_PROJECT}/taken/probe-slice.md`;
    const taskNote = `Projecten/${SCRATCH_PROJECT}/taken/probe-child.md`;
    const todoNote = `Projecten/${SCRATCH_PROJECT}/todos/probe-todo.md`;
    nestVault.notes.set(sliceNote, vaultNote('Building', []));
    nestVault.notes.set(taskNote, vaultNote('Building', []));
    nestVault.notes.set(todoNote, vaultNote('open', []));

    const nesting = await run(
      'nesting: slice → task → to-do parent chain',
      async () => {
        const sliceId = await nestWriter.executeTask({
          task: canonical({
            notePath: sliceNote,
            title: 'Probe slice',
            status: 'Building',
          }),
          current: null,
          projectId,
          sectionId: null,
          parentId: null,
          labels: ['slice'],
          description: '',
          notePath: sliceNote,
          noteContent: nestVault.notes.get(sliceNote),
          syncedAt,
        });
        const taskId = await nestWriter.executeTask({
          task: canonical({
            notePath: taskNote,
            title: 'Probe child',
            status: 'Building',
          }),
          current: null,
          projectId,
          sectionId: null,
          parentId: sliceId,
          labels: ['task'],
          description: '',
          notePath: taskNote,
          noteContent: nestVault.notes.get(taskNote),
          syncedAt,
        });
        const todoId = await nestWriter.executeToDo({
          todo: {
            todoistId: '',
            notePath: todoNote,
            projectName: SCRATCH_PROJECT,
            taskLink: '',
            parentTodoLink: null,
            title: 'Probe to-do',
            status: 'open',
          },
          current: null,
          projectId,
          parentId: taskId,
          notePath: todoNote,
          noteContent: nestVault.notes.get(todoNote),
          syncedAt,
        });

        const active = await todoist.fetchActiveTasks(projectId);
        const slice = active.find((t) => t.id === sliceId);
        const child = active.find((t) => t.id === taskId);
        const todo = active.find((t) => t.id === todoId);
        if (!slice || !child || !todo) throw new Error('a level is missing');
        if (slice.parentId !== null) throw new Error('slice is not top-level');
        if (child.parentId !== sliceId)
          throw new Error('task is not under the slice');
        if (todo.parentId !== taskId)
          throw new Error('to-do is not under the task');
        return `slice(null) → task(${child.parentId === sliceId}) → to-do(${todo.parentId === taskId})`;
      },
    );

    void nesting;
  } catch (error) {
    record(
      'probe aborted',
      'FAIL',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    try {
      if (projectId) {
        await fetch(`https://api.todoist.com/api/v1/projects/${projectId}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${todoistToken}` },
        });
        record('cleanup: delete scratch Todoist project', 'ok', projectId);
      }
      const labels = await fetch('https://api.todoist.com/api/v1/labels', {
        headers: { Authorization: `Bearer ${todoistToken}` },
      }).then((r) => r.json());
      const label = Array.isArray(labels?.results)
        ? labels.results.find((l) => l.name === PROBE_LABEL)
        : undefined;
      if (label) {
        await fetch(`https://api.todoist.com/api/v1/labels/${label.id}`, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${todoistToken}` },
        });
        record('cleanup: delete probe label', 'ok', label.id);
      }
      if (projectNodeId) {
        await githubGraphql(
          githubToken,
          `mutation($projectId: ID!) { deleteProjectV2(input: { projectId: $projectId }) { projectV2 { id } } }`,
          { projectId: projectNodeId },
        );
        record('cleanup: delete scratch GitHub board', 'ok', projectNodeId);
      }
    } catch (error) {
      record(
        'cleanup failed',
        'FAIL',
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
    }
  }

  console.log('\n=== operation results ===');
  for (const result of results) {
    console.log(`- [${result.outcome}] ${result.step}`);
  }
  const failures = results.filter((r) => r.outcome === 'FAIL');
  console.log(
    `\n${results.length - failures.length}/${results.length} steps ok · Todoist calls=${todoistCallsTotal} GitHub calls=${githubCallsTotal}`,
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
