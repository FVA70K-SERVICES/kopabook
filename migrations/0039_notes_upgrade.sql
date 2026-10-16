-- 0039: Notebook upgrade - note colors and pins
ALTER TABLE notes ADD COLUMN color TEXT NOT NULL DEFAULT 'default';
ALTER TABLE notes ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
