import type { RegisteredAdapter } from '../data/RegisteredAdapter.js';

export interface MirrorAdapterFactoryPort {
  create(application: string, target: string): RegisteredAdapter | null;
}
