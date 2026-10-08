export const CAPABILITIES = [
  'project',
  'lifecycle',
  'Status',
  'label',
  'identity',
  'title',
  'body',
  'subtasks',
  'completion',
  'capture',
  'task-locking',
  'trustworthy per-field timestamps',
  'complete-fetch',
] as const;

export type Capability = (typeof CAPABILITIES)[number];

export const UNIVERSAL_CAPABILITIES: readonly Capability[] = [
  'project',
  'lifecycle',
  'Status',
  'label',
];

export const MANDATORY_FIELD_CAPABILITIES: readonly Capability[] = [
  'identity',
  'title',
  'body',
  'subtasks',
  'completion',
];

export function isCapability(value: string): value is Capability {
  return (CAPABILITIES as readonly string[]).includes(value);
}
