// The vault's note-facing entry point for the checklist core. The
// implementation lives in the shared kernel, which imports from no vault
// module; this re-export keeps the vault import path stable for every
// note-facing caller.
export * from '../shared/Checklist.js';
