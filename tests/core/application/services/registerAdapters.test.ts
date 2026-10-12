import { describe, expect, it } from 'vitest';
import { AdapterDescriptor } from '../../../../src/core/application/data/AdapterDescriptor.js';
import type { Capability } from '../../../../src/core/domain/capabilities.js';
import { REQUIRED_CAPABILITIES } from '../../../../src/core/domain/capabilities.js';
import { AdapterRegistration } from '../../../../src/core/application/data/AdapterRegistration.js';
import { registerAdapters } from '../../../../src/core/application/services/registerAdapters.js';
import { ConformanceMirrorAdapter } from '../../../../src/infrastructure/fake/ConformanceMirrorAdapter.js';
import { conformanceDescriptor } from '../../../../src/infrastructure/fake/conformanceDescriptor.js';

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
        ...REQUIRED_CAPABILITIES,
        'sprints' as unknown as Capability,
      ],
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

  it('exposes the mirror surface the adapter carries, not a descriptor gate (ACM-8)', () => {
    const mirror = new ConformanceMirrorAdapter();
    const registered = registerAdapters([
      new AdapterRegistration(conformanceDescriptor('capable'), mirror),
    ]).adapters.get('capable')!;

    expect(registered.adapter).toBe(mirror);
    expect(registered.adapter.lockTask).toBeDefined();
    expect(registered.adapter.latestActivity).toBeDefined();
  });

  it('rejects an adapter that cannot represent the mandatory surface (ACM-8, ACM-9)', () => {
    const descriptor = new AdapterDescriptor({
      applicationId: 'acme',
      capabilities: [...REQUIRED_CAPABILITIES].filter(
        (capability) => capability !== 'subtasks',
      ),
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
