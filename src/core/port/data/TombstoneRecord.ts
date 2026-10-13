export interface TombstoneRecord {
  entityId: string;
  notePath: string;
  deletedAt: string;
  handle?: string;
}
