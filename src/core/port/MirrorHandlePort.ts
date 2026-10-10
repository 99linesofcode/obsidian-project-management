// The core's need: map a vault entity to the handle its mirror item carries,
// remember a handle once the mirror item exists, and enumerate the handles a
// connection already holds for a project. The core never sees a provider's
// identifier shape — the adapter owns that.
export interface MirrorHandlePort {
  resolve(connection: string, notePath: string): Promise<string | null>;
  list(
    project: string,
    connection: string,
  ): Promise<readonly { handle: string; notePath: string }[]>;
  // Records the handle for the entity, replacing any handle already recorded
  // for it on this connection. A placeholder recorded before creation is
  // replaced by the real handle once the mirror item exists.
  record(
    project: string,
    connection: string,
    notePath: string,
    handle: string,
  ): Promise<void>;
}
