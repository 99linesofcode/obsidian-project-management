// A board linked to a repository, as the derivation ladder sees it: the node id
// and title the ladder keys on, plus the url adoption re-resolves the field
// addressing from. Field ids are deliberately absent — adoption re-resolves
// them through fetchProjectIdentity, so a stale listing can never carry stale
// addressing into the registry.
export interface RepoBoardData {
  projectNodeId: string;
  name: string;
  boardUrl: string;
}

// The repository's node id together with its linked boards, in one listing
// read. The node id lets discovery seed an identity for a repo that has no
// board yet, so the sync chain's create step can address the repository.
export interface RepositoryBoardsData {
  repoNodeId: string;
  boards: RepoBoardData[];
}
