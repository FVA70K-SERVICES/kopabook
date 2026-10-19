-- KopaBook Projects: full project accountability (migration 0048)
-- Projects track every income and expense from start to finish,
-- with milestones, then generate a complete accountability report.

CREATE TABLE IF NOT EXISTS projects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'custom',
  description TEXT NOT NULL DEFAULT '',
  budget REAL NOT NULL DEFAULT 0,
  start_date TEXT,
  end_date TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  kind TEXT NOT NULL CHECK (kind IN ('income', 'expense')),
  amount REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  receipt_url TEXT,
  recorded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS project_milestones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  business_id INTEGER NOT NULL REFERENCES businesses(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  due_date TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_projects_business ON projects(business_id, status);
CREATE INDEX IF NOT EXISTS idx_ptxn_project ON project_transactions(project_id, created_at);
CREATE INDEX IF NOT EXISTS idx_pmil_project ON project_milestones(project_id, status);
