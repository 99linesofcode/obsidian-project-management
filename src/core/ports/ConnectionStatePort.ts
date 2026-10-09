import type { PortState } from '../data/PortState.js';

export interface ConnectionStatePort {
  listPortStates(
    projectName: string,
  ): Promise<Array<{ slug: string; state: PortState }>>;
  rekeyPortState(
    projectName: string,
    fromSlug: string,
    toSlug: string,
  ): Promise<void>;
}
