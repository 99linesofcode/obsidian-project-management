#!/usr/bin/env node
// Live probe for the Todoist adapter (dt-12). The vitest fakes prove the
// adapter's logic; this script proves the integration against the real API.
// It is deliberately NOT wired into vitest or CI — it needs a personal token
// and touches the network.
//
// Safety: it only ever creates and deletes a scratch project named
// "OPM live probe" (plus a scratch label). It never reads or writes any other
// project. Cleanup runs even when a step fails.
//
// Run: node scripts/todoist-probe.mjs
import { readFileSync } from 'node:fs';
import {
  TodoistAdapter,
  createTodoistTransport,
} from '../src/Infrastructure/Todoist/TodoistAdapter.ts';

const TOKEN_PATH = '/home/shorty/.config/sops-nix/secrets/todoist_api_key';
const BASE_URL = 'https://api.todoist.com/api/v1';
const SCRATCH_PROJECT = 'OPM live probe';
const ENSURE_PROJECT = 'OPM live probe ensure';
const PROBE_LABEL = 'opm-live-probe';

const findings = [];
const results = [];

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

function readToken() {
  return readFileSync(TOKEN_PATH, 'utf8').trim();
}

async function rawRequest(token, method, path) {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await response.text();
  return {
    status: response.status,
    headers: response.headers,
    json: text.length > 0 ? JSON.parse(text) : null,
  };
}

// Deletes the scratch projects and the probe label. Raw requests, because the
// port deliberately has no deleteProject/deleteLabel operation.
async function cleanup(token, projectIds) {
  for (const projectId of projectIds) {
    if (!projectId) {
      continue;
    }
    const status = await rawRequest(token, 'DELETE', `/projects/${projectId}`);
    record(
      'cleanup: delete scratch project',
      status.status < 300 ? 'ok' : 'FAIL',
      `status ${status.status}`,
    );
  }
  const labels = await rawRequest(token, 'GET', '/labels');
  const probeLabel = Array.isArray(labels.json?.results)
    ? labels.json.results.find((label) => label.name === PROBE_LABEL)
    : undefined;
  if (probeLabel) {
    const status = await rawRequest(
      token,
      'DELETE',
      `/labels/${probeLabel.id}`,
    );
    record(
      'cleanup: delete probe label',
      status.status < 300 ? 'ok' : 'FAIL',
      `status ${status.status}`,
    );
  }
}

async function main() {
  const token = readToken();
  const adapter = new TodoistAdapter(createTodoistTransport(token));
  let projectId;
  let ensureProjectId;

  try {
    // --- Rate-limit headers (dt-12 finding 1) -----------------------------
    const probe = await rawRequest(token, 'GET', '/projects?limit=1');
    const limit = probe.headers.get('x-ratelimit-limit');
    const remaining = probe.headers.get('x-ratelimit-remaining');
    const reset = probe.headers.get('x-ratelimit-reset');
    const retryAfter = probe.headers.get('retry-after');
    findings.push(
      `rate-limit headers: limit=${limit ?? 'absent'} remaining=${remaining ?? 'absent'} reset=${reset ?? 'absent'} retry-after=${retryAfter ?? 'absent'}`,
    );
    record(
      'rate-limit header probe',
      'ok',
      `limit=${limit ?? 'absent'} remaining=${remaining ?? 'absent'}`,
    );

    // --- Project lifecycle ------------------------------------------------
    const project = await run('createProject', () =>
      adapter.createProject(SCRATCH_PROJECT),
    );
    projectId = project?.id;

    await run('fetchProjects (scratch present)', async () => {
      const projects = await adapter.fetchProjects();
      const found = projects.some((candidate) => candidate.id === projectId);
      if (!found) {
        throw new Error('scratch project not in fetchProjects result');
      }
      return `${projects.length} projects`;
    });

    await run('updateProject (rename)', () =>
      adapter.updateProject(projectId, `${SCRATCH_PROJECT} (renamed)`),
    );

    // --- Sections ---------------------------------------------------------
    const section = await run('createSection', () =>
      adapter.createSection(projectId, 'Probe lane'),
    );
    const section2 = await run('createSection (second lane)', () =>
      adapter.createSection(projectId, 'Probe lane 2'),
    );

    await run('fetchSections', async () => {
      const sections = await adapter.fetchSections(projectId);
      if (!sections.some((candidate) => candidate.id === section?.id)) {
        throw new Error('created section not in fetchSections result');
      }
      return `${sections.length} sections`;
    });

    // --- Section name collision (dt-12 finding 6) -------------------------
    try {
      const duplicate = await adapter.createSection(projectId, 'Probe lane');
      findings.push(
        `section name collision: creating an existing name SUCCEEDED with a new id ${duplicate.id} (duplicate allowed)`,
      );
      record(
        'section name collision',
        'ok',
        `duplicate created ${duplicate.id}`,
      );
    } catch (error) {
      findings.push(
        `section name collision: creating an existing name ERRORED (${error instanceof Error ? error.message : String(error)})`,
      );
      record('section name collision', 'ok', 'rejected as expected');
    }

    // --- Section rename (t3 lane rename) ----------------------------------
    // A lane rename keeps its section: the projection renames the section in
    // place rather than creating a duplicate beside the stale one.
    await run('updateSection (rename)', () =>
      adapter.updateSection(section2?.id, 'Probe lane 2 renamed'),
    );
    await run('updateSection (renamed name visible)', async () => {
      const sections = await adapter.fetchSections(projectId);
      const renamed = sections.find(
        (candidate) => candidate.id === section2?.id,
      );
      if (renamed?.name !== 'Probe lane 2 renamed') {
        throw new Error('section rename not visible in fetchSections');
      }
      return renamed.name;
    });

    // --- Tasks ------------------------------------------------------------
    const task = await run('createTask (top-level, sectioned)', () =>
      adapter.createTask({
        projectId,
        sectionId: section?.id,
        content: 'Probe task',
        labels: [PROBE_LABEL],
      }),
    );

    const subtask = await run('createTask (subtask)', () =>
      adapter.createTask({
        projectId,
        parentId: task?.id,
        content: 'Probe subtask',
      }),
    );

    await run('updateTask (content + labels)', () =>
      adapter.updateTask(task?.id, {
        content: 'Probe task (updated)',
        labels: [PROBE_LABEL],
      }),
    );

    await run('moveTask (between sections)', () =>
      adapter.moveTask(task?.id, { sectionId: section2?.id }),
    );

    const task2 = await run('createTask (second top-level)', () =>
      adapter.createTask({ projectId, content: 'Probe task 2' }),
    );
    await run('moveTask (under parent)', () =>
      adapter.moveTask(task2?.id, { parentId: task?.id }),
    );

    await run('fetchActiveTasks', async () => {
      const active = await adapter.fetchActiveTasks(projectId);
      if (active.length < 3) {
        throw new Error(
          `expected at least 3 active tasks, got ${active.length}`,
        );
      }
      return `${active.length} active tasks`;
    });

    // --- Completion + completed-since query (dt-12 finding 3) -------------
    await run('setTaskCompleted(true)', () =>
      adapter.setTaskCompleted(task?.id, true),
    );

    const since = new Date(Date.now() - 60_000).toISOString();
    await run('fetchCompletedTasks (since 60s ago)', async () => {
      const completed = await adapter.fetchCompletedTasks(projectId, since);
      if (!completed.some((candidate) => candidate.id === task?.id)) {
        throw new Error('completed task not in completed-since result');
      }
      findings.push(
        `completed-since query: GET /tasks/completed/by_completion_date?since=&until=&project_id= returned ${completed.length} item(s); item keys include task_id`,
      );
      return `${completed.length} completed`;
    });

    // --- Reopen on a subtask whose parent is active (dt-12 finding 4) -----
    await run('setTaskCompleted(subtask, true)', () =>
      adapter.setTaskCompleted(subtask?.id, true),
    );
    await run('setTaskCompleted(subtask, false) [reopen]', () =>
      adapter.setTaskCompleted(subtask?.id, false),
    );
    await run('reopen subtask is active again', async () => {
      const active = await adapter.fetchActiveTasks(projectId);
      const reopened = active.find((candidate) => candidate.id === subtask?.id);
      if (!reopened) {
        throw new Error('reopened subtask not in active set');
      }
      findings.push(
        `reopen on a subtask with an active parent: SUCCEEDED; subtask reappears in the active set (parentId=${reopened.parentId})`,
      );
      return 'active';
    });

    // --- Labels (dt-12 finding 5) -----------------------------------------
    await run('ensureLabel (create)', () => adapter.ensureLabel(PROBE_LABEL));
    await run('ensureLabel (existing, no-op)', () =>
      adapter.ensureLabel(PROBE_LABEL),
    );
    findings.push(
      'ensureLabel: a second call for an existing label no-ops (adapter checks the list first); a raw create of an existing label is not attempted',
    );

    // --- Archive lifecycle ------------------------------------------------
    await run('setProjectArchived(true)', () =>
      adapter.setProjectArchived(projectId, true),
    );
    await run('setProjectArchived(false)', () =>
      adapter.setProjectArchived(projectId, false),
    );

    // --- Ensure-by-name flow (t2 project mirror) --------------------------
    // The project mirror resolves a project by name before creating, so a name
    // match is adopted rather than duplicated. This exercises the adapter
    // operations that flow uses: create, resolve-by-name, rename, archive,
    // unarchive, and resolve-by-name after a delete.
    const ensureProject = await run('ensure: createProject', () =>
      adapter.createProject(ENSURE_PROJECT),
    );
    ensureProjectId = ensureProject?.id;

    await run('ensure: resolve by name', async () => {
      const projects = await adapter.fetchProjects();
      const found = projects.find(
        (candidate) => candidate.name === ENSURE_PROJECT,
      );
      if (!found || found.id !== ensureProjectId) {
        throw new Error('created project not resolvable by name');
      }
      return found.id;
    });

    await run('ensure: rename', () =>
      adapter.updateProject(ensureProjectId, `${ENSURE_PROJECT} (renamed)`),
    );
    await run('ensure: resolve by renamed name', async () => {
      const projects = await adapter.fetchProjects();
      const found = projects.find(
        (candidate) => candidate.name === `${ENSURE_PROJECT} (renamed)`,
      );
      if (!found || found.id !== ensureProjectId) {
        throw new Error('renamed project not resolvable by name');
      }
      return found.id;
    });

    await run('ensure: archive', () =>
      adapter.setProjectArchived(ensureProjectId, true),
    );
    await run('ensure: archived state visible', async () => {
      // The list endpoint omits archived projects, so the archived state is
      // read by id — the same path the project mirror uses.
      const found = await adapter.fetchProject(ensureProjectId);
      if (!found?.isArchived) {
        throw new Error('project not archived in fetchProject');
      }
      return 'archived';
    });

    await run('ensure: unarchive', () =>
      adapter.setProjectArchived(ensureProjectId, false),
    );
    await run('ensure: unarchived state visible', async () => {
      const projects = await adapter.fetchProjects();
      const found = projects.find(
        (candidate) => candidate.id === ensureProjectId,
      );
      if (found?.isArchived) {
        throw new Error('project still archived in fetchProjects');
      }
      return 'active';
    });

    await run('ensure: delete scratch project', async () => {
      const status = await rawRequest(
        token,
        'DELETE',
        `/projects/${ensureProjectId}`,
      );
      if (status.status >= 300) {
        throw new Error(`delete failed with status ${status.status}`);
      }
      return `status ${status.status}`;
    });
    await run(
      'ensure: resolve by name after delete returns nothing',
      async () => {
        const projects = await adapter.fetchProjects();
        const found = projects.find(
          (candidate) => candidate.name === `${ENSURE_PROJECT} (renamed)`,
        );
        if (found) {
          throw new Error('deleted project still resolvable by name');
        }
        return 'not found';
      },
    );
    ensureProjectId = undefined;

    // --- Delete cascade (dt-12 finding 2) ---------------------------------
    const cascadeParent = await run('createTask (cascade parent)', () =>
      adapter.createTask({ projectId, content: 'Cascade parent' }),
    );
    const cascadeChild = await run('createTask (cascade child)', () =>
      adapter.createTask({
        projectId,
        parentId: cascadeParent?.id,
        content: 'Cascade child',
      }),
    );
    await run('deleteTask (cascade parent)', () =>
      adapter.deleteTask(cascadeParent?.id),
    );
    await run('delete cascade check', async () => {
      const active = await adapter.fetchActiveTasks(projectId);
      const childSurvived = active.some(
        (candidate) => candidate.id === cascadeChild?.id,
      );
      findings.push(
        `delete cascade: deleting a parent task ${childSurvived ? 'LEFT the subtask alive (no cascade)' : 'REMOVED the subtask (cascade)'}`,
      );
      return childSurvived ? 'subtask survived' : 'subtask removed';
    });

    await run('deleteTask (second top-level)', () =>
      adapter.deleteTask(task2?.id),
    );
  } catch (error) {
    record(
      'probe aborted',
      'FAIL',
      error instanceof Error ? error.message : String(error),
    );
    process.exitCode = 1;
  } finally {
    try {
      await cleanup(token, [projectId, ensureProjectId]);
    } catch (error) {
      record(
        'cleanup failed',
        'FAIL',
        error instanceof Error ? error.message : String(error),
      );
      process.exitCode = 1;
    }
  }

  console.log('\n=== dt-12 spike findings ===');
  for (const finding of findings) {
    console.log(`- ${finding}`);
  }
  console.log('\n=== operation results ===');
  for (const result of results) {
    console.log(`- [${result.outcome}] ${result.step}`);
  }
  const failures = results.filter((result) => result.outcome === 'FAIL');
  console.log(
    `\n${results.length - failures.length}/${results.length} steps ok`,
  );
  if (failures.length > 0) {
    process.exitCode = 1;
  }
}

await main();
