/**
 * Test helper — insert the {@link SEED_PROJECTS} rows with their fixed ids.
 *
 * The seeded timeline's `file_edit` activities reference fixed project ids
 * (`seed-project-dashboard`, `seed-project-api`). With `foreign_keys=ON` the
 * matching `projects` rows must exist before those activities are inserted.
 * `upsertProject` generates a fresh uuid, so it cannot reproduce the fixed
 * ids — this helper inserts them directly. Test-only.
 */
import type { Db } from '../../storage/db.js';
import { SEED_PROJECTS } from './seed-timeline.js';

/** Insert every {@link SEED_PROJECTS} row with its fixed id (idempotent). */
export function seedProjects(db: Db): void {
  const stmt = db.prepare(
    `INSERT OR IGNORE INTO projects (id, workspace, name, created_at)
     VALUES (?, ?, ?, ?)`,
  );
  for (const project of Object.values(SEED_PROJECTS)) {
    stmt.run(project.id, project.workspace, project.name, 0);
  }
}
