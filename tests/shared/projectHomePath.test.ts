import { describe, expect, it } from 'vitest';
import {
  projectHomePath,
  projectHomeStem,
} from '../../src/shared/projectHomePath.js';

describe('DISC-2 — the home note path follows the convention', () => {
  it('builds the active home path under Projecten', () => {

    const path = projectHomePath('Acme Widgets', false);

    expect(path).toBe('Projecten/Acme Widgets/_Acme Widgets.md');
  });

  it('builds the archived home path under Archief', () => {

    const path = projectHomePath('Acme Widgets', true);

    expect(path).toBe('Archief/Acme Widgets/_Acme Widgets.md');
  });

  it('keeps the stem unique to the project', () => {

    const first = projectHomeStem('Acme Widgets');
    const second = projectHomeStem('Other Project');

    expect(first).toBe('_Acme Widgets');
    expect(second).toBe('_Other Project');
  });
});
