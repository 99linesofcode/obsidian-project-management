// The core's need to resolve and record the handle a connection's application
// uses for the mirror project — the project-level peer of the mirror-handle
// port. Designed for the core, not the provider's API.
export interface MirrorProjectPort {
  resolve(project: string, connection: string): Promise<string | null>;
  record(
    project: string,
    connection: string,
    application: string,
    handle: string,
  ): Promise<void>;
}
