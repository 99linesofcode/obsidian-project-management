import { describe, expect, it } from 'vitest';
import { SyncQueue } from '../../../src/ui/sync/SyncQueue.js';
import type { SyncProjectAction } from '../../../src/core/application/actions/SyncProjectAction.js';

// A fake chain that records the projects it runs, tracks concurrency, and can
// block (so serialization is observable) or fail a project (so poisoning is
// observable).
class FakeChain {
  calls: string[] = [];
  active = 0;
  maxActive = 0;
  block = false;
  failFor = new Set<string>();
  private resolvers: Array<() => void> = [];

  async execute(project: string): Promise<void> {
    this.active++;
    this.maxActive = Math.max(this.maxActive, this.active);
    this.calls.push(project);
    if (this.block) {
      await new Promise<void>((resolve) => this.resolvers.push(resolve));
    }
    this.active--;
    if (this.failFor.has(project)) {
      throw new Error('boom');
    }
  }

  releaseAll(): void {
    for (const resolve of this.resolvers) {
      resolve();
    }
    this.resolvers = [];
  }
}

function queueFor(chain: FakeChain): SyncQueue {
  return new SyncQueue(chain as unknown as SyncProjectAction);
}

// Flushes the microtask queue so the drain loop can advance between releases.
async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('REG-2 — racing operations both land', () => {
  it('runs one project at a time', async () => {
    const chain = new FakeChain();
    chain.block = true;
    const queue = queueFor(chain);

    queue.enqueue('A');
    queue.enqueue('B');
    await flush();

    expect(chain.calls).toEqual(['A']);
    expect(chain.maxActive).toBe(1);

    chain.releaseAll();
    await flush();

    expect(chain.calls).toEqual(['A', 'B']);
    expect(chain.maxActive).toBe(1);
    chain.releaseAll();
    await queue.whenIdle();
  });

  it('absorbs a duplicate enqueue while the project is pending', async () => {
    const chain = new FakeChain();
    chain.block = true;
    const queue = queueFor(chain);
    queue.enqueue('A');
    queue.enqueue('B');

    queue.enqueue('B');
    chain.releaseAll();
    await flush();
    chain.releaseAll();
    await queue.whenIdle();

    expect(chain.calls).toEqual(['A', 'B']);
  });

  it('queues a duplicate behind a running project', async () => {
    const chain = new FakeChain();
    chain.block = true;
    const queue = queueFor(chain);
    queue.enqueue('A');

    queue.enqueue('A');
    chain.releaseAll();
    await flush();

    expect(chain.calls).toEqual(['A', 'A']);
    chain.releaseAll();
    await queue.whenIdle();
  });

  it('keeps running after a project fails', async () => {
    const chain = new FakeChain();
    chain.block = true;
    chain.failFor.add('A');
    const queue = queueFor(chain);

    queue.enqueue('A');
    queue.enqueue('B');
    chain.releaseAll();
    await flush();
    chain.releaseAll();
    await queue.whenIdle();

    expect(chain.calls).toEqual(['A', 'B']);
  });

  it('runs items in enqueue order, a rename immediately', async () => {
    const chain = new FakeChain();
    const queue = queueFor(chain);

    queue.enqueue('A');
    queue.enqueue('B');
    queue.enqueue('C');
    await queue.whenIdle();

    expect(chain.calls).toEqual(['A', 'B', 'C']);
  });
});
