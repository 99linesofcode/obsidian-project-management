export interface GithubResponse {
  status: number;
  json: unknown;
  etag?: string;
}

export interface GithubTransport {
  post(body: string): Promise<GithubResponse>;
  get(path: string): Promise<GithubResponse>;
  patch(path: string, body: string): Promise<GithubResponse>;
  postPath(path: string, body: string): Promise<GithubResponse>;
  putPath(path: string, body: string): Promise<GithubResponse>;
}
