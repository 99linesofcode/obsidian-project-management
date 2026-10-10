// The core's need: close a task's conversation thread while its project is
// frozen, and reopen it on unfreeze. Designed for the core, not the provider's
// lock API; an adapter without the surface declares no `task-locking`.
export interface TaskLockPort {
  lockTask(handle: string): Promise<void>;
  unlockTask(handle: string): Promise<void>;
}
