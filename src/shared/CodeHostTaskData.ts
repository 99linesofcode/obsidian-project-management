// A code-host issue as fetched from the provider, in the shape the port
// carries. This is a provider transport DTO, not the domain shape: the
// code-host mapper maps it (with its board card) onto the canonical TaskData
// at the boundary.
export interface CodeHostTaskData {
  url: string;
  nodeId: string;
  title: string;
  body: string;
  state: 'open' | 'closed';
  // The issue's creation stamp, when the transport carries one (GraphQL
  // `createdAt`, REST `created_at`); null when the provider shape has none.
  createdAt: string | null;
  // WHY lastEditedAt and not updatedAt is the canonical content clock: the
  // provider's `updatedAt` also moves on comments, so treating it as the
  // content clock would make a comment read as a title/body edit and could
  // force a spurious conflict decision. `lastEditedAt` moves only on
  // title/body edits.
  lastEditedAt: string | null;
  // The comment-noisy provider timestamp, kept for callers that ask "did
  // anything on this issue move" (the probe); never the canonical content
  // clock.
  updatedAt: string;
  labels: string[];
  // The issue's parent relation (code-host sub-issues), as the parent issue's
  // url, or null when the issue has none. WHY a url and not a uuid: the
  // transport is provider-shaped, and the url is the code-host mirror handle
  // the registry can resolve. Placement is a diffed dimension now, so a
  // sub-issue's parent must survive the fetch.
  parentUrl: string | null;
}
