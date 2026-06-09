/**
 * Activity repository — insert and time-bounded slice queries.
 *
 * The `payload` column stores variant-specific JSON; this module is the single
 * serialize/deserialize boundary. The slice query carries an explicit `LIMIT`
 * matching the hard event cap (plan Boundary 5 — bounded slice).
 */
import type { Activity } from '@wdiot/shared';
import { parseActivity } from '@wdiot/shared';
import type { Db } from './db.js';

/** Hard event cap for a single context-window slice (plan B5). */
export const HARD_EVENT_CAP = 500;

/** A raw `activities` table row. */
interface ActivityRow {
  id: string;
  type: string;
  source: string;
  ts: number;
  project_id: string | null;
  payload: string;
}

function rowToActivity(row: ActivityRow): Activity {
  return parseActivity({
    id: row.id,
    type: row.type,
    source: row.source,
    ts: row.ts,
    projectId: row.project_id ?? undefined,
    payload: JSON.parse(row.payload),
  });
}

/** Insert one activity. `projectId` is persisted only when present (file_edit). */
export function insertActivity(db: Db, activity: Activity): void {
  const stmt = db.prepare(
    `INSERT INTO activities (id, type, source, ts, project_id, payload)
     VALUES (@id, @type, @source, @ts, @project_id, @payload)`,
  );
  stmt.run({
    id: activity.id,
    type: activity.type,
    source: activity.source,
    ts: activity.ts,
    project_id: activity.projectId ?? null,
    payload: JSON.stringify(activity.payload),
  });
}

/** Insert many activities inside a single transaction. */
export function insertActivities(db: Db, activities: readonly Activity[]): void {
  const insertAll = db.transaction((rows: readonly Activity[]) => {
    for (const row of rows) insertActivity(db, row);
  });
  insertAll(activities);
}

/**
 * Slice activities with `ts >= sinceTs`, ordered by `ts` ascending, capped at
 * `limit` rows (default = {@link HARD_EVENT_CAP}). Powers context-window
 * assembly via `idx_activities_ts`.
 */
export function sliceActivities(
  db: Db,
  sinceTs: number,
  limit: number = HARD_EVENT_CAP,
): Activity[] {
  const rows = db
    .prepare(
      `SELECT id, type, source, ts, project_id, payload
       FROM activities
       WHERE ts >= ?
       ORDER BY ts ASC
       LIMIT ?`,
    )
    .all(sinceTs, limit) as ActivityRow[];

  return rows.map(rowToActivity);
}

/**
 * Slice the most recent activities with `ts >= sinceTs`, capped at `limit`.
 * This powers the timeline UI, where recency matters more than preserving the
 * full context-window chronological order.
 */
export function sliceRecentActivities(
  db: Db,
  sinceTs: number,
  limit: number = HARD_EVENT_CAP,
): Activity[] {
  const rows = db
    .prepare(
      `SELECT id, type, source, ts, project_id, payload
       FROM activities
       WHERE ts >= ?
       ORDER BY ts DESC
       LIMIT ?`,
    )
    .all(sinceTs, limit) as ActivityRow[];

  return rows.map(rowToActivity);
}

/** Total number of stored activities (debug / tests). */
export function countActivities(db: Db): number {
  const row = db.prepare('SELECT COUNT(*) AS n FROM activities').get() as { n: number };
  return row.n;
}
