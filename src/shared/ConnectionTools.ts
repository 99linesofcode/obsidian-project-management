// The closed set of adapter tool ids a connection may name. A connection's tool
// selects the port that serves it; the connection slug is the registry key.
export const CONNECTION_TOOLS = ['github', 'todoist'] as const;

export type ConnectionTool = (typeof CONNECTION_TOOLS)[number];

export function isConnectionTool(value: string): value is ConnectionTool {
  return (CONNECTION_TOOLS as readonly string[]).includes(value);
}
