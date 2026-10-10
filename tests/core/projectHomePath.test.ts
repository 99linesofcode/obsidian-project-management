import { describe, expect, it } from 'vitest';
import {
  chooseHomeNotePath,
  projectHomePath,
  projectHomeStem,
} from '../../src/core/projectHomePath.js';

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

describe('DISC-2 — home note discovery prefers the convention', () => {
  it('prefers the conventional home note when a legacy one lingers beside it', () => {
    const chosen = chooseHomeNotePath(
      [
        'Projecten/Acme Widgets/_home.md',
        'Projecten/Acme Widgets/_Acme Widgets.md',
      ],
      'Acme Widgets',
    );

    expect(chosen).toBe('Projecten/Acme Widgets/_Acme Widgets.md');
  });

  it('falls back to the only candidate when no conventional note exists', () => {
    const chosen = chooseHomeNotePath(
      ['Projecten/Acme Widgets/_home.md'],
      'Acme Widgets',
    );

    expect(chosen).toBe('Projecten/Acme Widgets/_home.md');
  });

  it('returns null when the project has no home note', () => {
    expect(chooseHomeNotePath([], 'Acme Widgets')).toBeNull();
  });
});
