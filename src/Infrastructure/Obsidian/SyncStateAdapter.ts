import type { Status } from '../../Domain/Models/Status.js';
import type { SyncStatePort } from '../../Domain/Ports/SyncStatePort.js';

// The storage the adapter persists through. main.ts binds the plugin's
// loadData/saveData so records live in the plugin's data.json.
export interface SyncStateStorage {
  load(): Promise<Record<string, unknown>>;
  save(data: unknown): Promise<void>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Implements the sync state port against a flat key/value store. Records are
// namespaced so status and last-poll cursors never collide: status.<url> and
// lastPoll.<projectName>.
export class SyncStateAdapter implements SyncStatePort {
  constructor(private readonly storage: SyncStateStorage) {}

  async get(url: string): Promise<Status | null> {
    const data = await this.storage.load();
    const raw = data[`status.${url}`];
    return isRecord(raw) ? this.mapStatus(raw) : null;
  }

  async set(status: Status): Promise<void> {
    const data = await this.storage.load();
    data[`status.${status.url}`] = status;
    await this.storage.save(data);
  }

  async findByNotePath(notePath: string): Promise<Status | null> {
    const data = await this.storage.load();
    for (const [key, raw] of Object.entries(data)) {
      if (key.startsWith('status.') && isRecord(raw) && raw.notePath === notePath) {
        return this.mapStatus(raw);
      }
    }
    return null;
  }

  async remove(url: string): Promise<void> {
    const data = await this.storage.load();
    delete data[`status.${url}`];
    await this.storage.save(data);
  }

  private mapStatus(raw: Record<string, unknown>): Status {
    return {
      url: typeof raw.url === 'string' ? raw.url : '',
      remoteId: typeof raw.remoteId === 'number' ? raw.remoteId : 0,
      notePath: typeof raw.notePath === 'string' ? raw.notePath : '',
      lastSyncedBodyHash: typeof raw.lastSyncedBodyHash === 'string' ? raw.lastSyncedBodyHash : '',
      lastSyncedRemoteUpdatedAt:
        typeof raw.lastSyncedRemoteUpdatedAt === 'string' ? raw.lastSyncedRemoteUpdatedAt : '',
      lastSyncedStatus: raw.lastSyncedStatus === 'done' ? 'done' : 'open',
      lastSyncedTitle: typeof raw.lastSyncedTitle === 'string' ? raw.lastSyncedTitle : '',
    };
  }

  async getLastPoll(projectName: string): Promise<string | null> {
    const data = await this.storage.load();
    const raw = data[`lastPoll.${projectName}`];
    return typeof raw === 'string' ? raw : null;
  }

  async setLastPoll(projectName: string, iso: string): Promise<void> {
    const data = await this.storage.load();
    data[`lastPoll.${projectName}`] = iso;
    await this.storage.save(data);
  }
}
