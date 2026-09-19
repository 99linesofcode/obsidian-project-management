import { describe, expect, it } from 'vitest';
import {
  TaskStatus,
  taskStatusFromState,
} from '../../../src/Domain/Enums/TaskStatus.js';

describe('TaskStatus', () => {
  it('maps an open state to open', () => {
    // Given — an open remote state

    // When — it is mapped
    const status = taskStatusFromState('open');

    // Then — the status is open
    expect(status).toBe(TaskStatus.Open);
  });

  it('maps a closed state to done', () => {
    // Given — a closed remote state

    // When — it is mapped
    const status = taskStatusFromState('closed');

    // Then — the status is done
    expect(status).toBe(TaskStatus.Done);
  });
});
