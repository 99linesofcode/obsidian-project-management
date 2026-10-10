export interface TaskManagerResponse {
  status: number;
  json: unknown;
}

export interface TaskManagerTransport {
  get(path: string): Promise<TaskManagerResponse>;
  post(path: string, body: string): Promise<TaskManagerResponse>;
  delete(path: string): Promise<TaskManagerResponse>;
}
