import { describe, expect, it } from 'vitest';
import { AdapterDescriptor } from '../../src/core/AdapterDescriptor.js';
import type { Capability } from '../../src/core/Capabilities.js';
import {
  MANDATORY_FIELD_CAPABILITIES,
  UNIVERSAL_CAPABILITIES,
} from '../../src/core/Capabilities.js';
import { AdapterRegistration } from '../../src/core/data/AdapterRegistration.js';
import { registerAdapters } from '../../src/core/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../src/infrastructure/fake/conformanceDescriptor.js';

describe('registerAdapters — the one contract gate (ACM-9)', () => {
  it('accepts a conforming descriptor into the map', () => {
    const result = registerAdapters([
      new AdapterRegistration(
        conformanceDescriptor('acme'),
        new ConformanceMirrorAdapter(),
      ),
    ]);

    expect(result.errors).toHaveLength(0);
    expect(result.adapters.get('acme')?.descriptor.applicationId).toBe('acme');
  });

  it('rejects a descriptor declaring an unknown capability (ACM-2, ACM-9)', () => {
    const descriptor = new AdapterDescriptor({
      applicationId: 'acme',
      capabilities: [
        ...UNIVERSAL_CAPABILITIES,
        ...MANDATORY_FIELD_CAPABILITIES,
        'sprints' as unknown as Capability,
      ],
      representations: {},
      secretKeys: [],
      settingsRows: [],
    });

    const result = registerAdapters([
      new AdapterRegistration(descriptor, new ConformanceMirrorAdapter()),
    ]);

    expect(result.adapters.size).toBe(0);
    expect(result.errors[0]?.reason).toBe('unknown capability: sprints');
  });

  it('rejects a second adapter with a duplicate application id (ACM-4, ACM-9)', () => {
    const result = registerAdapters([
      new AdapterRegistration(
        conformanceDescriptor('acme'),
        new ConformanceMirrorAdapter(),
      ),
      new AdapterRegistration(
        conformanceDescriptor('acme'),
        new ConformanceMirrorAdapter(),
      ),
    ]);

    expect(result.adapters.size).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]?.reason).toBe('duplicate application id');
  });

  it('rejects an application id outside the lowercase slug convention (ACM-4, ACM-9)', () => {
    const result = registerAdapters([
      new AdapterRegistration(
        conformanceDescriptor('Acme_Corp'),
        new ConformanceMirrorAdapter(),
      ),
    ]);

    expect(result.adapters.size).toBe(0);
    expect(result.errors[0]?.reason).toBe(
      'application id must be lowercase alphanumerics with dashes',
    );
  });

  it('exposes the task-lock port only when the adapter declares the capability (ACM-8)', () => {
    const capable = registerAdapters([
      new AdapterRegistration(
        conformanceDescriptor('capable'),
        new ConformanceMirrorAdapter(),
      ),
    ]).adapters.get('capable')!;
    const base = conformanceDescriptor('plain');
    const withoutLock = new AdapterDescriptor({
      applicationId: base.applicationId,
      capabilities: base.capabilities.filter(
        (capability) => capability !== 'task-locking',
      ),
      representations: base.representations,
      secretKeys: base.secretKeys,
      settingsRows: base.settingsRows,
    });
    const plain = registerAdapters([
      new AdapterRegistration(withoutLock, new ConformanceMirrorAdapter()),
    ]).adapters.get('plain')!;

    expect(capable.taskLock).toBeDefined();
    expect(plain.taskLock).toBeUndefined();
  });

  it('rejects an adapter that cannot represent the mandatory surface (ACM-8, ACM-9)', () => {
    const descriptor = new AdapterDescriptor({
      applicationId: 'acme',
      capabilities: [
        ...UNIVERSAL_CAPABILITIES,
        ...MANDATORY_FIELD_CAPABILITIES,
      ].filter((capability) => capability !== 'subtasks'),
      representations: {},
      secretKeys: [],
      settingsRows: [],
    });

    const result = registerAdapters([
      new AdapterRegistration(descriptor, new ConformanceMirrorAdapter()),
    ]);

    expect(result.adapters.size).toBe(0);
    expect(result.errors[0]?.reason).toBe('out of scope: missing subtasks');
  });
});
