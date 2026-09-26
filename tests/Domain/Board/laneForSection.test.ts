import { describe, expect, it } from 'vitest';
import { laneForSection } from '../../../src/Domain/Board/laneForSection.js';

const sections = { Building: 'S1', Shipped: 'S2' };

describe('laneForSection', () => {
  it('resolves a section id to its lane name', () => {
    // Given — a lane map and a known section id

    // When — the lane is resolved
    const lane = laneForSection(sections, 'S2');

    // Then — the lane name is returned
    expect(lane).toBe('Shipped');
  });

  it('returns null for a null section id', () => {
    // Given — a section-less item

    // When — the lane is resolved
    const lane = laneForSection(sections, null);

    // Then — there is no lane
    expect(lane).toBeNull();
  });

  it('returns null for a section outside the lane map', () => {
    // Given — a section id that is not a lane

    // When — the lane is resolved
    const lane = laneForSection(sections, 'S9');

    // Then — there is no lane
    expect(lane).toBeNull();
  });
});
