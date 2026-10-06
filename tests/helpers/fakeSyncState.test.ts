import { runSyncStateConformance } from './syncStateConformance.js';
import { FakeSyncState } from './fakeSyncState.js';

// The shared port contract, run against the in-memory fake. The same suite runs
// against the real SyncStateAdapter (tests/Infrastructure/Obsidian/
// SyncStateAdapter.test.ts). Migration cases are adapter-only: the fake has no
// persisted container, so its harness omits the migration capability.
runSyncStateConformance('FakeSyncState', {
  create(options) {
    const fake = new FakeSyncState();
    for (const project of options?.pendingProjects ?? []) {
      fake.fullScanPending.add(project);
    }
    return fake;
  },
});
