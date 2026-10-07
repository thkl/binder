ALTER TABLE maintenance_runs
  ADD COLUMN IF NOT EXISTS progress JSONB NOT NULL DEFAULT '[]'::jsonb;
