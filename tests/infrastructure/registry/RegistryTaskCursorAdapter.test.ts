import { describe, expect, it } from 'vitest';
import { RegistryTaskCursorAdapter } from '../../../src/infrastructure/registry/RegistryTaskCursorAdapter.js';

class FakeStore {
  readonly values = new Map<string, string>();

  async read(key: string): Promise<string | null> {
    return this.values.get(key) ?? null;
  }

  async write(key: string, value: string): Promise<void> {
    this.values.set(key, value);
  }
}

describe('RegistryTaskCursorAdapter — the per-connection task watermark', () => {
  it('reads and writes a handle under a project-and-connection key', async () => {
    const store = new FakeStore();
    const adapter = new RegistryTaskCursorAdapter(store);

    await adapter.write('Acme Widgets', 'github', 'A');

    expect(await adapter.read('Acme Widgets', 'github')).toBe('A');
    expect(await adapter.read('Acme Widgets', 'todoist')).toBeNull();
  });
});
