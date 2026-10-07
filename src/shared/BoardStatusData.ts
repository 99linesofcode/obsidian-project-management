export class BoardStatusData {
  projectNodeId: string;
  statusFieldId: string;
  issueUrl: string;
  statusOptionId: string;

  constructor(init: BoardStatusData) {
    this.projectNodeId = init.projectNodeId;
    this.statusFieldId = init.statusFieldId;
    this.issueUrl = init.issueUrl;
    this.statusOptionId = init.statusOptionId;
  }
}
