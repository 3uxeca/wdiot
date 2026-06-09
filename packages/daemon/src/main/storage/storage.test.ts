import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import type { Activity } from '@wdiot/shared';
import { openDatabase, schemaVersion, type Db } from './db.js';
import {
  insertActivity,
  insertActivities,
  sliceActivities,
  sliceRecentActivities,
  countActivities,
  HARD_EVENT_CAP,
} from './activity-repo.js';
import { upsertProject, findProjectByWorkspace } from './project-repo.js';

let db: Db;

beforeEach(() => {
  db = openDatabase(':memory:');
});

afterEach(() => {
  db.close();
});

describe('db migrations', () => {
  it('applies the initial migration and sets user_version', () => {
    expect(schemaVersion(db)).toBe(1);
  });

  it('creates the activities and projects tables', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).toContain('activities');
    expect(names).toContain('projects');
  });

  it('is idempotent — re-opening does not re-apply', () => {
    db.close();
    db = openDatabase(':memory:');
    expect(schemaVersion(db)).toBe(1);
  });
});

describe('activity-repo round-trip', () => {
  it('inserts an Activity and slices it back', () => {
    const activity: Activity = {
      id: 'act-1',
      type: 'app_switch',
      source: 'app',
      ts: 1_700_000_000_000,
      payload: { appName: 'Cursor', bundleId: 'com.todesktop.x', windowTitle: 'index.ts' },
    };
    insertActivity(db, activity);

    const sliced = sliceActivities(db, 0);
    expect(sliced).toHaveLength(1);
    expect(sliced[0]).toEqual(activity);
  });

  it('round-trips a file_edit activity with projectId and nested payload', () => {
    const project = upsertProject(db, '/Users/me/code/wdiot', 'wdiot');
    const activity: Activity = {
      id: 'act-2',
      type: 'file_edit',
      source: 'ide',
      ts: 1_700_000_100_000,
      projectId: project.id,
      payload: {
        workspacePath: '/Users/me/code/wdiot',
        filePath: '/Users/me/code/wdiot/src/index.ts',
        recentFiles: ['/Users/me/code/wdiot/src/a.ts'],
        cursorLine: 12,
        selectionText: 'const x = 1;',
        hasGitDiff: true,
      },
    };
    insertActivity(db, activity);

    const [row] = sliceActivities(db, 0);
    expect(row).toEqual(activity);
    expect(row?.projectId).toBe(project.id);
  });

  it('slices only activities at or after sinceTs, ordered by ts', () => {
    const make = (id: string, ts: number): Activity => ({
      id,
      type: 'app_switch',
      source: 'app',
      ts,
      payload: { appName: 'App-' + id },
    });
    insertActivities(db, [
      make('c', 3000),
      make('a', 1000),
      make('b', 2000),
    ]);

    const all = sliceActivities(db, 0);
    expect(all.map((a) => a.id)).toEqual(['a', 'b', 'c']);

    const recent = sliceActivities(db, 2000);
    expect(recent.map((a) => a.id)).toEqual(['b', 'c']);
  });

  it('respects the LIMIT (hard event cap)', () => {
    const many: Activity[] = Array.from({ length: 10 }, (_, i) => ({
      id: 'm-' + i,
      type: 'app_switch' as const,
      source: 'app' as const,
      ts: 1000 + i,
      payload: { appName: 'App' },
    }));
    insertActivities(db, many);

    expect(countActivities(db)).toBe(10);
    expect(sliceActivities(db, 0, 4)).toHaveLength(4);
    expect(HARD_EVENT_CAP).toBe(500);
  });

  it('slices the latest activities for timeline queries', () => {
    const make = (id: string, ts: number): Activity => ({
      id,
      type: 'app_switch',
      source: 'app',
      ts,
      payload: { appName: 'App-' + id },
    });
    insertActivities(db, [
      make('old', 1000),
      make('middle', 2000),
      make('new', 3000),
    ]);

    const recent = sliceRecentActivities(db, 0, 2);
    expect(recent.map((a) => a.id)).toEqual(['new', 'middle']);
  });
});

describe('project-repo', () => {
  it('upserts and looks up a project by workspace path', () => {
    const created = upsertProject(db, '/Users/me/code/proj', 'proj');
    expect(created.id).toBeTruthy();

    const found = findProjectByWorkspace(db, '/Users/me/code/proj');
    expect(found?.id).toBe(created.id);
    expect(found?.name).toBe('proj');
  });

  it('upsert is idempotent on workspace path and refreshes the name', () => {
    const first = upsertProject(db, '/Users/me/code/proj', 'old-name');
    const second = upsertProject(db, '/Users/me/code/proj', 'new-name');
    expect(second.id).toBe(first.id);
    expect(second.name).toBe('new-name');
    expect(second.createdAt).toBe(first.createdAt);
  });
});
