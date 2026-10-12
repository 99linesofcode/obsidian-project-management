import type { App, EventRef } from 'obsidian';
import { VaultAdapter } from '../../src/infrastructure/vault/VaultAdapter.js';

// A VaultAdapter for tests that exercise the note/origin/source surface.
export function vaultAdapter(
  app: App,
  options: {
    registerEvent?: (eventRef: EventRef) => void;
    registeredApplications?: ReadonlySet<string>;
  } = {},
): VaultAdapter {
  return new VaultAdapter(
    app,
    options.registerEvent ?? (() => {}),
    options.registeredApplications ?? new Set(),
  );
}
