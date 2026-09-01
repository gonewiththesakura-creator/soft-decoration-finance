DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0008_import_scope') THEN
    ALTER TABLE import_jobs ADD COLUMN IF NOT EXISTS migration_batch_id integer REFERENCES import_batches(id);
    ALTER TABLE skus DROP CONSTRAINT IF EXISTS skus_code_key;
    CREATE UNIQUE INDEX IF NOT EXISTS skus_project_code_idx ON skus(project_id,code);
    ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_number_key;
    CREATE UNIQUE INDEX IF NOT EXISTS invoices_company_number_idx ON invoices(company_id,number);
    DROP INDEX IF EXISTS import_jobs_source_hash_idx;
    CREATE UNIQUE INDEX import_jobs_source_hash_idx ON import_jobs(source_hash) WHERE source_hash IS NOT NULL AND status='已完成';
    INSERT INTO schema_migrations(version) VALUES ('0008_import_scope');
  END IF;
END
$migration$;
