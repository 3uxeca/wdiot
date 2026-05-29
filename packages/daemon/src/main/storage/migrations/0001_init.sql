-- WDIOT v1 — initial schema (plan Boundary 4).
-- `projects` materializes the Project ontology entity; `activities` stores the
-- unified timeline as a single table with a typed JSON `payload` column.

CREATE TABLE projects (
  id           TEXT PRIMARY KEY,
  workspace    TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);

CREATE TABLE activities (
  id           TEXT PRIMARY KEY,
  type         TEXT NOT NULL,          -- app_switch | browser_tab | file_edit | search
  source       TEXT NOT NULL,          -- app | browser | ide
  ts           INTEGER NOT NULL,       -- epoch ms
  project_id   TEXT REFERENCES projects(id),
  payload      TEXT NOT NULL           -- JSON, variant-specific
);

CREATE INDEX idx_activities_ts        ON activities(ts);
CREATE INDEX idx_activities_type_ts   ON activities(type, ts);
CREATE INDEX idx_activities_project   ON activities(project_id);
