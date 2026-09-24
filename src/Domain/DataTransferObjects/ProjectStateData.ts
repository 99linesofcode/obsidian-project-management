// A project's lightweight remote state, in the shape the core needs. The poll
// probes every discovered project with one cheap aliased node query; updatedAt
// is the diff that decides whether the expensive board fetch is warranted this
// tick. closed is carried for the archive feature to come — it is unused today,
// so the probe never has to be re-shaped when archiving lands.
export interface ProjectStateData {
  projectId: string;
  updatedAt: string;
  closed: boolean;
}
