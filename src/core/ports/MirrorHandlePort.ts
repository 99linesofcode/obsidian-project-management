export interface MirrorHandlePort {
  resolve(connection: string, notePath: string): Promise<string | null>;
  record(
    project: string,
    connection: string,
    notePath: string,
    handle: string,
  ): Promise<void>;
}
