// A Todoist project as fetched from the provider, in the shape the core
// needs. The core never sees raw Todoist JSON; t2's project mirror consumes
// this. isArchived drives the Archief/ freeze (dt-10): an archived project
// accepts no writes, so sync pauses until it is unarchived. createdAt is the
// provider's creation clock, used by the project-capture cursor (PRJ-2) so a
// project born after the last poll is captured while every pre-existing one is
// left alone. Optional because an older/partial payload may omit it; a null
// creation time is treated as "not new" by the cursor (never adopted).
export interface TodoistProjectData {
  id: string;
  name: string;
  isArchived: boolean;
  createdAt?: string | null;
}
