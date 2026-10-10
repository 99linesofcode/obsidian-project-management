// The vault note's own `connections:` entry vocabulary (tool + project). The
// origin's shape, parsed and rendered by the vault codecs; mapped onto the
// canonical ConnectionDataTransferObject at the boundary.
export interface FrontmatterConnection {
  tool: string;
  project: string;
}
