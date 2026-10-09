import { requestUrl } from 'obsidian';
import type {
  TaskManagerResponse,
  TaskManagerTransport,
} from './TaskManagerTransport.js';

const BASE_URL = 'https://api.todoist.com/api/v1';

export function createTodoistTransport(token: string): TaskManagerTransport {
  const request = async (
    method: string,
    path: string,
    body?: string,
  ): Promise<TaskManagerResponse> => {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
    };
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    const response = await requestUrl({
      url: `${BASE_URL}${path}`,
      method,
      headers,
      ...(body === undefined ? {} : { body }),
      throw: false,
    });
    const text = response.text;
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text);
      } catch {
        json = null;
      }
    }
    return { status: response.status, json };
  };
  return {
    get: (path) => request('GET', path),
    post: (path, body) => request('POST', path, body),
    delete: (path) => request('DELETE', path),
  };
}
