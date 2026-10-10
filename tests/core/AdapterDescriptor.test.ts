import { describe, expect, it } from 'vitest';
import { AdapterDescriptor } from '../../src/core/AdapterDescriptor.js';
import type { Capability } from '../../src/core/Capabilities.js';

const MANDATORY: readonly Capability[] = [
  'project',
  'lifecycle',
  'Status',
  'label',
  'title',
  'body',
  'subtasks',
  'completion',
];

describe('AdapterDescriptor.represents', () => {
  it('represents a field declared natively by its capability (ACM-5)', () => {
    const descriptor = new AdapterDescriptor({
      applicationId: 'native',
      capabilities: MANDATORY,
      representations: {},
      secretKeys: [],
      settingsRows: [],
    });

    expect(descriptor.represents('title')).toBe(true);
  });

  it('represents a field bridged by a declared mapping (ACM-5, ACM-6)', () => {
    const descriptor = new AdapterDescriptor({
      applicationId: 'mapped',
      capabilities: MANDATORY.filter((capability) => capability !== 'Status'),
      representations: { Status: { mappedTo: 'label' } },
      secretKeys: [],
      settingsRows: [],
    });

    expect(descriptor.represents('Status')).toBe(true);
  });

  it('does not represent a field with no capability and no mapping (ACM-5, ACM-7)', () => {
    const descriptor = new AdapterDescriptor({
      applicationId: 'without-body',
      capabilities: MANDATORY.filter((capability) => capability !== 'body'),
      representations: {},
      secretKeys: [],
      settingsRows: [],
    });

    expect(descriptor.represents('body')).toBe(false);
  });
});
