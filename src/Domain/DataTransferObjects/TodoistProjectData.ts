// A Todoist project as fetched from the provider, in the shape the core
// needs. The core never sees raw Todoist JSON; t2's project mirror consumes
// this. isArchived drives the Archief/ freeze (dt-10): an archived project
// accepts no writes, so sync pauses until it is unarchived.
export interface TodoistProjectData {
  id: string;
  name: string;
  isArchived: boolean;
}
