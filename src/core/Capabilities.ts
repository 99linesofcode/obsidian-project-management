export const CAPABILITIES = [
  'project',
  'lifecycle',
  'Status',
  'label',
  'title',
  'body',
  'subtasks',
  'completion',
  'capture',
  'task-locking',
  'project-activity',
  'trustworthy per-field timestamps',
  'complete-fetch',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

// The surface every adapter must declare: the ports the core's merge and
// lifecycle passes call unconditionally. Every other capability is optional —
// an adapter declares the ones it has, and an undeclared one has no interface
// to call.
export const REQUIRED_CAPABILITIES: readonly Capability[] = [
  'project',
  'lifecycle',
  'Status',
  'label',
  'title',
  'body',
  'subtasks',
  'completion',
];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}
