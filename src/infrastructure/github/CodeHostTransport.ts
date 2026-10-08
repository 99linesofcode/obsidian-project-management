export interface CodeHostResponse {
  status: number;
  json: unknown;
  etag?: string;
}

export interface CodeHostTransport {
  post(body: string): Promise<CodeHostResponse>;
  get(path: string): Promise<CodeHostResponse>;
  getConditional(path: string, etag?: string): Promise<CodeHostResponse>;
  patch(path: string, body: string): Promise<CodeHostResponse>;
  postPath(path: string, body: string): Promise<CodeHostResponse>;
  putPath(path: string, body: string): Promise<CodeHostResponse>;
}
