import { describe, expect, it } from 'vitest';
import { ProjectMapper } from '../../src/projects/ProjectMapper.js';
import type { TodoistProjectData } from '../../src/todoist/TodoistProjectData.js';

const context = {
  path: 'Projecten/Acme Widgets',
  doneLane: 'Shipped',
  archivedAt: null,
  repoUrl: 'https://github.com/acme/widgets',
};

describe('PRJ-4 — a project payload is canonical before the core sees it', () => {
  it('maps a ProjectV2 payload onto the canonical project content', () => {
    const payload = {
      id: 'PVT_123',
      name: 'Acme Widgets',
      closed: false,
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Unshaped' },
        { id: 'PVTSSF_2', name: 'Shipped' },
      ],
    };

    const project = ProjectMapper.fromCodeHostProject(payload, context);

    expect(project.name).toBe('Acme Widgets');
    expect(project.archivedAt).toBeNull();
    expect(project.statusOptions).toEqual(['Unshaped', 'Shipped']);
    expect(project.doneLane).toBe('Shipped');
    expect(project.mirrors).toEqual({
      github: 'https://github.com/acme/widgets',
    });
  });

  it('stamps an archived project with the reconciled stamp', () => {
    const payload = {
      id: 'PVT_123',
      name: 'Acme Widgets',
      closed: true,
      statusOptions: [],
    };

    const project = ProjectMapper.fromCodeHostProject(payload, {
      ...context,
      archivedAt: '2026-09-18T12:00:00Z',
    });

    expect(project.archivedAt).toBe('2026-09-18T12:00:00Z');
  });

  it('uses the migrated empty stamp when archived before a stamp existed', () => {
    const payload = {
      id: 'PVT_123',
      name: 'Acme Widgets',
      closed: true,
      statusOptions: [],
    };

    const project = ProjectMapper.fromCodeHostProject(payload, context);

    expect(project.archivedAt).toBe('');
  });
});

describe('ProjectMapper.fromRemoteProject', () => {
  it('maps a Todoist project payload onto the canonical project content', () => {
    const payload: TodoistProjectData = {
      id: 'P1',
      name: 'Acme Widgets',
      isArchived: false,
    };

    const project = ProjectMapper.fromRemoteProject(payload, context);

    expect(project.name).toBe('Acme Widgets');
    expect(project.archivedAt).toBeNull();
    expect(project.statusOptions).toEqual([]);
    expect(project.mirrors).toEqual({ todoist: 'P1' });
  });

  it('carries the provider creation clock as the canonical createdAt', () => {
    const payload: TodoistProjectData = {
      id: 'P1',
      name: 'Acme Widgets',
      isArchived: false,
      createdAt: '2026-10-01T08:00:00Z',
    };

    const project = ProjectMapper.fromRemoteProject(payload, context);

    expect(project.createdAt).toBe('2026-10-01T08:00:00Z');
  });

  it('marks an archived Todoist project with the migrated empty stamp', () => {
    const payload: TodoistProjectData = {
      id: 'P1',
      name: 'Acme Widgets',
      isArchived: true,
    };

    const project = ProjectMapper.fromRemoteProject(payload, context);

    expect(project.archivedAt).toBe('');
  });
});

describe('ProjectMapper.fromCodeHostBoard', () => {
  it('maps a viewer board onto the canonical content with its url and clock', () => {
    const payload = {
      id: 'PVT_9',
      name: 'Fresh Board',
      closed: false,
      createdAt: '2026-10-02T09:00:00Z',
      url: 'https://github.com/users/acme/projects/9',
      statusOptions: [
        { id: 'PVTSSF_1', name: 'Unshaped' },
        { id: 'PVTSSF_2', name: 'Shipped' },
      ],
    };

    const project = ProjectMapper.fromCodeHostBoard(payload, context);

    expect(project.name).toBe('Fresh Board');
    expect(project.mirrors).toEqual({
      github: 'https://github.com/users/acme/projects/9',
    });
    expect(project.createdAt).toBe('2026-10-02T09:00:00Z');
    expect(project.statusOptions).toEqual(['Unshaped', 'Shipped']);
    expect(project.doneLane).toBe('Shipped');
    expect(project.archivedAt).toBeNull();
  });

  it('marks a closed board with the reconciled archive stamp', () => {
    const payload = {
      id: 'PVT_9',
      name: 'Fresh Board',
      closed: true,
      createdAt: null,
      url: 'https://github.com/users/acme/projects/9',
      statusOptions: [],
    };

    const project = ProjectMapper.fromCodeHostBoard(payload, {
      ...context,
      archivedAt: '2026-09-18T12:00:00Z',
    });

    expect(project.archivedAt).toBe('2026-09-18T12:00:00Z');
    expect(project.createdAt).toBeNull();
  });
});