// The two sync halves as abstractions. The chain orchestrates provider-neutral
// steps, so it depends on these narrow contracts rather than the concrete
// provider actions; the composition root supplies the implementations. This is
// what keeps a provider's name out of the chain while still letting each half
// keep its own input shape.

// The code-host half: fetch the remote's tracked tasks and reconcile them with
// the vault. includeBoard is the probe's verdict — the remote moved since the
// last poll — so the half can skip the fetch when nothing moved.
export interface CodeHostSyncHalf {
  execute(input: {
    projectName: string;
    syncedAt: string;
    includeBoard: boolean;
  }): Promise<void>;
}

// The task-manager half: mirror the vault's tasks and to-dos into the remote
// project. projectId is the remote project the lifecycle resolved for this
// tick.
export interface TaskManagerSyncHalf {
  execute(input: {
    projectName: string;
    projectId: string;
    syncedAt: string;
  }): Promise<void>;
}
