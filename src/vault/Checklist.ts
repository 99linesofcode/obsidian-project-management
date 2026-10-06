// The vault's note-facing entry point for the checklist core. The
// implementation moved to the shared kernel (Reconciliation needs toIssueBody
// and the shared kernel imports from no vault module); this re-export keeps the
// vault import path stable for every note-facing caller.
export * from '../shared/Checklist.js';
