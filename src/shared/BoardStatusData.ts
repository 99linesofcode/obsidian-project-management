// The fields a BoardStatusData is built from. Named so a construction site
// reads as a record rather than a row of positional slots.
export interface BoardStatusDataInit {
  projectNodeId: string;
  statusFieldId: string;
  issueUrl: string;
  statusOptionId: string;
}

// A board Status write: the project and Status field addressing, the issue
// whose card moves, and the target option id. The four together are one
// concept — a card's lane change — so they cross the port as one value object
// rather than four loose strings.
export class BoardStatusData {
  projectNodeId: string;
  statusFieldId: string;
  issueUrl: string;
  statusOptionId: string;

  constructor(init: BoardStatusDataInit) {
    this.projectNodeId = init.projectNodeId;
    this.statusFieldId = init.statusFieldId;
    this.issueUrl = init.issueUrl;
    this.statusOptionId = init.statusOptionId;
  }
}
