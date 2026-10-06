// A remote project as fetched from a task manager, in the provider-neutral
// shape the core reasons about. The core never sees a provider's raw JSON; the
// task-manager adapter maps its payload onto this at the boundary. isArchived
// drives the Archief/ freeze (dt-10): an archived project accepts no writes, so
// sync pauses until it is unarchived. createdAt is the provider's creation
// clock, used by the project-capture cursor (PRJ-2) so a project born after the
// last poll is captured while every pre-existing one is left alone. Optional
// because an older/partial payload may omit it; a null creation time is treated
// as "not new" by the cursor (never adopted).
export interface RemoteProjectData {
  id: string;
  name: string;
  isArchived: boolean;
  createdAt?: string | null;
}
