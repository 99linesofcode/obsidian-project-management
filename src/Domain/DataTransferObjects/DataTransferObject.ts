import { hash } from '../Notes/hash.js';

// Base class for canonical DTOs: one canonical serialization per DTO, hashed
// once, so no field list is duplicated between hash functions.
export abstract class DataTransferObject {
  abstract canonical(): string; // the diffed fields, \u0000-joined, in order
  snapshotHash(): string {
    return hash(this.canonical());
  }
}
