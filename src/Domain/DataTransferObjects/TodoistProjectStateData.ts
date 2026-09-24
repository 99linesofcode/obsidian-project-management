// The per-project Todoist bookkeeping, in the shape the core needs. It lives
// in data.json, never in notes (dt-04). sections maps a lane name to its
// Todoist section id — empty until t3 provisions the lanes; lastCompletedPoll
// is the ISO cursor the completed-since query resumes from (t4). The record is
// created when a project is first mirrored and survives the archived freeze, so
// unarchiving resumes where the sync left off.
export interface TodoistProjectStateData {
  sections: Record<string, string>;
  lastCompletedPoll: string;
}
