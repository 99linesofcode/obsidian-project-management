// The provider labels the core writes. A to-do twin carries TODO_LABEL; a
// slice twin carries SLICE_LABEL (and is retired, dt-23). One definition each,
// so a writer and a reader can never drift on the spelling.
export const TODO_LABEL = 'todo';
export const SLICE_LABEL = 'slice';

// The color a label gets when the plugin creates it (the seed action and the
// create-issue fallback). The provider's own default label gray, so a seeded
// label looks native rather than arbitrary.
export const DEFAULT_LABEL_COLOR = 'ededed';
