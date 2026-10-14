export interface TodoistResponse {
  status: number;
  json: unknown;
}

export interface TodoistTransport {
  get(path: string): Promise<TodoistResponse>;
  post(path: string, body: string): Promise<TodoistResponse>;
  delete(path: string): Promise<TodoistResponse>;
}
