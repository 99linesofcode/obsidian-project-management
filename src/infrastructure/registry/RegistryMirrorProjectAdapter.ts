import type { ConnectionStatePort } from '../../core/port/ConnectionStatePort.js';
import type { MirrorProjectPort } from '../../core/port/MirrorProjectPort.js';

export class RegistryMirrorProjectAdapter implements MirrorProjectPort {
  constructor(private readonly registry: ConnectionStatePort) {}

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
