import { describe, expect, it } from 'vitest';
import {
  projectFromNotePath,
  projectHomePath,
} from '../../../src/core/domain/paths.js';

// Characterization for S17c, taken before the change: today a project's name
// IS its folder segment, and the home-note path renders that name. These pass
// today; they pin the behaviour PLC-1..4 replaces so the change is a visible
// diff, not a surprise.
describe('characterization — the project name is the folder segment (today)', () => {
  it('reads the name from the folder segment under either root', () => {
    expect(
      projectFromNotePath('Projecten/Acme Widgets/taken/42-fix-the-bug.md'),
    ).toBe('Acme Widgets');
    expect(
      projectFromNotePath('Archief/Acme Widgets/_Acme Widgets.md'),
    ).toBe('Acme Widgets');
  });

  it('renders the home note as Projecten/<name>/_<name>.md', () => {
    expect(projectHomePath('Acme Widgets', false)).toBe(
      'Projecten/Acme Widgets/_Acme Widgets.md',
    );
    expect(projectHomePath('Acme Widgets', true)).toBe(
      'Archief/Acme Widgets/_Acme Widgets.md',
    );
  });
});
