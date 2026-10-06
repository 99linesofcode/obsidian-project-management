import { describe, expect, it } from 'vitest';
import { ProjectMapper } from '../../../src/Domain/Mappers/ProjectMapper.js';
import type { TodoistProjectData } from '../../../src/Domain/DataTransferObjects/TodoistProjectData.js';

const context = {
  path: 'Projecten/Acme Widgets',
  doneLane: 'Shipped',
  archivedAt: null,
  repoUrl: 'https://github.com/acme/widgets',
};

describe('ProjectMapper.fromGithubProject', () => {
  it('maps a ProjectV2 payload onto the canonical project content', () => {
    // Given — a GitHub project payload with Status options
    const payload = {
      id: 'PVT_123',
      name: 'Acme Widgets',
      closed: false,
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Unshaped' },
        { id: 'PVTSSF_2', name: 'Shipped' },
      ],
    };

    // When — it is mapped at the boundary
    const project = ProjectMapper.fromGithubProject(payload, context);

    // Then — the canonical content carries the option NAMES, never the ids
    expect(project.name).toBe('Acme Widgets');
    expect(project.archivedAt).toBeNull();
    expect(project.statusOptions).toEqual(['Unshaped', 'Shipped']);
    expect(project.doneLane).toBe('Shipped');
    expect(project.mirrors).toEqual({
      github: 'https://github.com/acme/widgets',
    });
  });

  it('stamps an archived project with the reconciled stamp', () => {
    // Given — a closed board and a known freeze stamp
    const payload = {
      id: 'PVT_123',
      name: 'Acme Widgets',
      closed: true,
      statusOptions: [],
    };

    // When — it is mapped
    const project = ProjectMapper.fromGithubProject(payload, {
      ...context,
      archivedAt: '2026-09-18T12:00:00Z',
    });

    // Then — the canonical stamp is the plugin's, not the provider's boolean
    expect(project.archivedAt).toBe('2026-09-18T12:00:00Z');
  });

  it('uses the migrated empty stamp when archived before a stamp existed', () => {
    // Given — a closed board with no known transition time
    const payload = {
      id: 'PVT_123',
      name: 'Acme Widgets',
      closed: true,
      statusOptions: [],
    };

    // When — it is mapped
    const project = ProjectMapper.fromGithubProject(payload, context);

    // Then — the migrated convention applies: archived, stamp unknown
    expect(project.archivedAt).toBe('');
  });
});

describe('ProjectMapper.fromTodoistProject', () => {
  it('maps a Todoist project payload onto the canonical project content', () => {
    // Given — a Todoist project
    const payload: TodoistProjectData = {
      id: 'P1',
      name: 'Acme Widgets',
      isArchived: false,
    };

    // When — it is mapped at the boundary
    const project = ProjectMapper.fromTodoistProject(payload, context);

    // Then — the name and mirror are carried; Todoist owns no lane vocabulary
    expect(project.name).toBe('Acme Widgets');
    expect(project.archivedAt).toBeNull();
    expect(project.statusOptions).toEqual([]);
    expect(project.mirrors).toEqual({ todoist: 'P1' });
  });

  it('marks an archived Todoist project with the migrated empty stamp', () => {
    // Given — an archived Todoist project
    const payload: TodoistProjectData = {
      id: 'P1',
      name: 'Acme Widgets',
      isArchived: true,
    };

    // When — it is mapped
    const project = ProjectMapper.fromTodoistProject(payload, context);

    // Then — archived with an unknown transition time
    expect(project.archivedAt).toBe('');
  });
});