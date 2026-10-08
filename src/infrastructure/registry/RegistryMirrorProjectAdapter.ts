import type { MirrorProjectPort } from '../../core/ports/MirrorProjectPort.js';

export interface MirrorProjectState {
  provider: string;
  project: string;
  lastPoll: string | null;
  lanes: Record<string, string>;
}

export interface MirrorProjectStateStore {
  getPortState(
    project: string,
    connection: string,
  ): Promise<MirrorProjectState | null>;
  setPortState(
    project: string,
    connection: string,
    state: MirrorProjectState,
  ): Promise<void>;
}

export class RegistryMirrorProjectAdapter implements MirrorProjectPort {
  constructor(private readonly registry: MirrorProjectStateStore) {}

  async resolve(project: string, connection: string): Promise<string | null> {
    const state = await this.registry.getPortState(project, connection);
    return state === null || state.project === '' ? null : state.project;
  }

  async record(
    project: string,
    connection: string,
    application: string,
    handle: string,
  ): Promise<void> {
    const state = await this.registry.getPortState(project, connection);
    await this.registry.setPortState(project, connection, {
      provider: state?.provider ?? application,
      project: handle,
      lastPoll: state?.lastPoll ?? null,
      lanes: state?.lanes ?? {},
    });
  }
}
