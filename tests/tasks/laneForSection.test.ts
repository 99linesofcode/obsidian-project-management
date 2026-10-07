import { describe, expect, it } from 'vitest';
import { laneForSection } from '../../src/tasks/laneForSection.js';

const sections = { Building: 'S1', Shipped: 'S2' };

describe('LANE-2 — a section names its lane', () => {
  it('resolves a section id to its lane name', () => {
    const lane = laneForSection(sections, 'S2');

    expect(lane).toBe('Shipped');
  });

  it('returns null for a null section id', () => {
    const lane = laneForSection(sections, null);

    expect(lane).toBeNull();
  });

  it('returns null for a section outside the lane map', () => {
    const lane = laneForSection(sections, 'S9');

    expect(lane).toBeNull();
  });
});
