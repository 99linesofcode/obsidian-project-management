// The closed set of adapter tool ids a connection may name. A connection's tool
// selects the port that serves it. The registry is provider-keyed in this
// ticket — the default slugs happen to match the provider names — and re-keys
// to connection slugs in the next ticket.
export const CONNECTION_TOOLS = ['github', 'todoist'] as const;

export type ConnectionTool = (typeof CONNECTION_TOOLS)[number];

export function isConnectionTool(value: string): value is ConnectionTool {
  return (CONNECTION_TOOLS as readonly string[]).includes(value);
}
