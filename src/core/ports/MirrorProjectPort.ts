export interface MirrorProjectPort {
  resolve(project: string, connection: string): Promise<string | null>;
  record(
    project: string,
    connection: string,
    application: string,
    handle: string,
  ): Promise<void>;
}
