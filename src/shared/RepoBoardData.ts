export interface RepoBoardData {
  projectNodeId: string;
  name: string;
  boardUrl: string;
}

export interface RepositoryBoardsData {
  repoNodeId: string;
  boards: RepoBoardData[];
}
