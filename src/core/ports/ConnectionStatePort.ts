import type { PortState } from '../data/PortState.js';

export interface ConnectionStatePort {
  getPortState(
    projectName: string,
    connectionSlug: string,
  ): Promise<PortState | null>;
  setPortState(
    projectName: string,
    connectionSlug: string,
    state: PortState,
  ): Promise<void>;
  listPortStates(
    projectName: string,
  ): Promise<Array<{ slug: string; state: PortState }>>;
  rekeyPortState(
    projectName: string,
    fromSlug: string,
    toSlug: string,
  ): Promise<void>;
}
