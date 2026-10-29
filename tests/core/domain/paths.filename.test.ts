import { describe, expect, it } from 'vitest';
import {
  projectHomePath,
  projectHomeStem,
} from '../../../src/core/domain/paths.js';

// FN-1 — the home note is the one filename that is not the title. It keeps its
// underscore so it floats to the top of the folder, and it is exempt from the
// renderer: a project name with characters the renderer would rewrite keeps
// them in the home note's stem.

describe('FN-1 — the home note is exempt and keeps _<project>.md', () => {
  it('keeps the underscore and the project name verbatim', () => {
    expect(projectHomePath('Acme Widgets', false)).toBe(
      'Projecten/Acme Widgets/_Acme Widgets.md',
    );
    expect(projectHomePath('Acme Widgets', true)).toBe(
      'Archief/Acme Widgets/_Acme Widgets.md',
    );
  });

  it('does not render the project name for the home note', () => {
    expect(projectHomeStem('Fix: it')).toBe('_Fix: it');
    expect(projectHomePath('Fix: it', false)).toBe(
      'Projecten/Fix: it/_Fix: it.md',
    );
  });
});
