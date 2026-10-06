// The provider labels the core writes. A to-do twin carries TODO_LABEL; a
// slice twin carries SLICE_LABEL (and is retired, dt-23). One definition each,
// so a writer and a reader can never drift on the spelling.
export const TODO_LABEL = 'todo';
export const SLICE_LABEL = 'slice';
