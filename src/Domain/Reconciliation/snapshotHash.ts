import { hash } from '../Notes/hash.js';

// The canonical snapshot fingerprint (dt-08): content, labels, section, parent
// and completion. Labels are sorted so their order never reads as a change. A
// subtask inherits its parent's section (dt-02), so its section is not a
// controlled field and enters as null. One function for every side, so the
// GitHub, Todoist and vault snapshots are comparable.
export interface SnapshotShape {
  content: string;
  labels: string[];
  sectionId: string | null;
  parentId: string | null;
  isCompleted: boolean;
}

export function snapshotHash(shape: SnapshotShape): string {
  return hash(
    [
      shape.content,
      [...shape.labels].sort().join(','),
      shape.sectionId ?? '',
      shape.parentId ?? '',
      shape.isCompleted ? '1' : '0',
    ].join('\n'),
  );
}
