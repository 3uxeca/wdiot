/**
 * Project repository — upsert / lookup of the Project ontology entity.
 *
 * A Project is keyed by its workspace path (UNIQUE). `file_edit` activities
 * carry a `projectId` resolved through this repo (plan B4 project resolution).
 */
import { randomUUID } from 'node:crypto';
import type { Db } from './db.js';

export interface Project {
  id: string;
  workspace: string;
  name: string;
  createdAt: number;
}

interface ProjectRow {
  id: string;
  workspace: string;
  name: string;
  created_at: number;
}

function rowToProject(row: ProjectRow): Project {
  return {
    id: row.id,
    workspace: row.workspace,
    name: row.name,
    createdAt: row.created_at,
  };
}

/** Look up a project by its workspace path; `undefined` when none exists. */
export function findProjectByWorkspace(db: Db, workspacePath: string): Project | undefined {
  const row = db
    .prepare('SELECT id, workspace, name, created_at FROM projects WHERE workspace = ?')
    .get(workspacePath) as ProjectRow | undefined;
  return row ? rowToProject(row) : undefined;
}

/** Look up a project by id; `undefined` when none exists. */
export function findProjectById(db: Db, id: string): Project | undefined {
  const row = db
    .prepare('SELECT id, workspace, name, created_at FROM projects WHERE id = ?')
    .get(id) as ProjectRow | undefined;
  return row ? rowToProject(row) : undefined;
}

/**
 * Upsert a project by workspace path. If a row already exists, its `name` is
 * refreshed (the id and created_at are preserved). Returns the resulting row.
 */
export function upsertProject(db: Db, workspacePath: string, name: string): Project {
  const existing = findProjectByWorkspace(db, workspacePath);
  if (existing) {
    if (existing.name !== name) {
      db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, existing.id);
      return { ...existing, name };
    }
    return existing;
  }

  const project: Project = {
    id: randomUUID(),
    workspace: workspacePath,
    name,
    createdAt: Date.now(),
  };
  db.prepare(
    'INSERT INTO projects (id, workspace, name, created_at) VALUES (?, ?, ?, ?)',
  ).run(project.id, project.workspace, project.name, project.createdAt);
  return project;
}
