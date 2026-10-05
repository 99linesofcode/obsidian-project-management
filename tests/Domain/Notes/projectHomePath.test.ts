import { describe, expect, it } from 'vitest';
import {
  projectHomePath,
  projectHomeStem,
} from '../../../src/Domain/Notes/projectHomePath.js';

describe('projectHomePath', () => {
  it('builds the active home path under Projecten', () => {
    // Given — an active project

    // When — the convention path is built
    const path = projectHomePath('Acme Widgets', false);

    // Then — the note is underscore-prefixed inside the project folder
    expect(path).toBe('Projecten/Acme Widgets/_Acme Widgets.md');
  });

  it('builds the archived home path under Archief', () => {
    // Given — a frozen project

    // When — the convention path is built
    const path = projectHomePath('Acme Widgets', true);

    // Then — the same underscore name lands under Archief/
    expect(path).toBe('Archief/Acme Widgets/_Acme Widgets.md');
  });

  it('keeps the stem unique to the project', () => {
    // Given — two projects whose home notes would collide as [[_home]]

    // When — their stems are built
    const first = projectHomeStem('Acme Widgets');
    const second = projectHomeStem('Other Project');

    // Then — the project name is embedded, so the wikilinks never collide
    expect(first).toBe('_Acme Widgets');
    expect(second).toBe('_Other Project');
  });
});
