export interface MirrorHandlePort {
  resolve(connection: string, notePath: string): Promise<string | null>;
}
