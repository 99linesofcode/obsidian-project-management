// The core's need: remember, per frozen project and connection, the last
// activity observation — the etag of the last conditional read and the newest
// item seen at that read. Designed for the core, not the registry's schema.
export interface ProjectWatchState {
  etag: string | null;
  cursor: string | null;
}

export interface ProjectWatchPort {
  read(project: string, connection: string): Promise<ProjectWatchState>;
  write(
    project: string,
    connection: string,
    state: ProjectWatchState,
  ): Promise<void>;
}
