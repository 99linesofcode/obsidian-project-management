// One tool connection declared in a project note's frontmatter: the tool id
// (from the closed adapter registry) and the opaque project string the tool's
// adapter interprets (a repository url for the code host, a project id for the
// task manager). The map key is the user-named connection slug.
export interface ConnectionData {
  tool: string;
  project: string;
}
