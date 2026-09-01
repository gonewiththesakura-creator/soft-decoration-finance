ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS source_hash text;
CREATE UNIQUE INDEX IF NOT EXISTS import_jobs_source_hash_idx ON import_jobs(source_hash) WHERE source_hash IS NOT NULL;
