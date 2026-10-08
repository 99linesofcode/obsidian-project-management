export interface MirrorHandlePort {
  resolve(connection: string, entityId: string): Promise<string | null>;
}
