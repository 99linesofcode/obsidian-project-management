export interface PortState {
  provider: string;
  project: string;
  lastPoll: string | null;
  lanes: Record<string, string>;
}
