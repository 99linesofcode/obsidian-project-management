import type { VaultPort } from '../../src/core/port/VaultPort.js';
import type { CanonicalField } from '../../src/core/domain/canonicalField.js';
import type { CanonicalFieldWrite } from '../../src/core/port/data/CanonicalFieldWrite.js';
import type { CanonicalTask } from '../../src/core/port/data/CanonicalTask.js';
import type { ConnectionDataTransferObject } from '../../src/core/port/data/ConnectionDataTransferObject.js';
import type { OriginObservation } from '../../src/core/domain/OriginObservation.js';
import type { ProjectNoteDataTransferObject } from '../../src/core/port/data/ProjectNoteDataTransferObject.js';

// The vault port's test double: every method throws until a test overrides the
// one it exercises, so a test states only the behaviour it needs and a missed
// stub fails loudly instead of returning a silent empty value.
export class FakeVault implements VaultPort {
  async getNoteByPath(_path: string): Promise<{ content: string } | null> {
    return notStubbed('getNoteByPath');
  }
  async createNote(_path: string, _content: string): Promise<void> {
    notStubbed('createNote');
  }
  async writeNote(_path: string, _content: string): Promise<void> {
    notStubbed('writeNote');
  }
  async renameNote(_oldPath: string, _newPath: string): Promise<void> {
    notStubbed('renameNote');
  }
  async trashNote(_path: string): Promise<void> {
    notStubbed('trashNote');
  }
  async listNotesInFolder(_folder: string): Promise<string[]> {
    return notStubbed('listNotesInFolder');
  }
  async findProjectNotes(): Promise<ProjectNoteDataTransferObject[]> {
    return notStubbed('findProjectNotes');
  }
  onNoteChanged(_cb: (path: string) => void): void {
    notStubbed('onNoteChanged');
  }
  onNoteDeleted(_cb: (path: string) => void): void {
    notStubbed('onNoteDeleted');
  }
  onNoteRenamed(_cb: (oldPath: string, newPath: string) => void): void {
    notStubbed('onNoteRenamed');
  }
  async observe(
    _handle: string,
    _field: CanonicalField,
  ): Promise<OriginObservation> {
    return notStubbed('observe');
  }
  async readTask(_handle: string): Promise<CanonicalTask | null> {
    return notStubbed('readTask');
  }
  async applyField(_write: CanonicalFieldWrite): Promise<void> {
    notStubbed('applyField');
  }
  async readConnections(
    _project: string,
  ): Promise<readonly ConnectionDataTransferObject[]> {
    return notStubbed('readConnections');
  }
  async listEntities(_project: string): Promise<readonly string[]> {
    return notStubbed('listEntities');
  }
  async observeProject(_project: string): Promise<OriginObservation> {
    return notStubbed('observeProject');
  }
  async applyProjectArchived(
    _project: string,
    _archived: boolean,
  ): Promise<void> {
    notStubbed('applyProjectArchived');
  }
}

function notStubbed(method: string): never {
  throw new Error(`FakeVault.${method} is not stubbed for this test`);
}
