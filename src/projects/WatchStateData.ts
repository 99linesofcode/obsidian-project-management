// The watch state for an archived project's repository, in the shape the core
// needs. etag is the ETag of the last conditional issue read, so a quiet repo
// answers 304 for free; cursor is the created_at of the newest issue seen at
// the last watch. A null cursor means the project has not been watched yet, so
// the first read adopts the current newest issue rather than re-activating on
// issues that predate the watch.
export interface WatchStateData {
  etag: string | null;
  cursor: string | null;
}
