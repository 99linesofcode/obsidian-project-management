import { describe, expect, it, vi } from 'vitest';

const { requestUrl } = vi.hoisted(() => ({ requestUrl: vi.fn() }));
vi.mock('obsidian', () => ({ requestUrl }));

import { createTodoistTransport } from '../../../src/infrastructure/todoist/TodoistTransport.js';

describe('createTodoistTransport — the live transport goes through requestUrl', () => {
  it('sends the bearer token and maps the response text to json', async () => {
    requestUrl.mockResolvedValueOnce({
      status: 200,
      text: JSON.stringify({ results: [] }),
      json: { results: [] },
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });
    const transport = createTodoistTransport('secret-token');

    const response = await transport.get('/projects');

    expect(requestUrl).toHaveBeenCalledWith({
      url: 'https://api.todoist.com/api/v1/projects',
      method: 'GET',
      headers: { Authorization: 'Bearer secret-token' },
      throw: false,
    });
    expect(response).toEqual({ status: 200, json: { results: [] } });
  });

  it('adds the JSON content type and body on a write, and tolerates an empty body', async () => {
    requestUrl.mockResolvedValueOnce({
      status: 204,
      text: '',
      json: null,
      headers: {},
      arrayBuffer: new ArrayBuffer(0),
    });
    const transport = createTodoistTransport('secret-token');

    const response = await transport.post('/tasks', '{"content":"x"}');

    expect(requestUrl).toHaveBeenCalledWith({
      url: 'https://api.todoist.com/api/v1/tasks',
      method: 'POST',
      headers: {
        Authorization: 'Bearer secret-token',
        'Content-Type': 'application/json',
      },
      body: '{"content":"x"}',
      throw: false,
    });
    expect(response).toEqual({ status: 204, json: null });
  });
});
