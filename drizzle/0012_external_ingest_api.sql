DO $migration$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version = '0012_external_ingest_api') THEN
    ALTER TABLE import_batches ADD COLUMN source_channel text NOT NULL DEFAULT 'UPLOAD_UI';
    UPDATE import_files SET channel='UPLOAD_UI' WHERE channel='UPLOAD';
    ALTER TABLE import_files ALTER COLUMN channel SET DEFAULT 'UPLOAD_UI';
    UPDATE import_batches b SET source_channel=f.channel FROM import_files f WHERE f.batch_id=b.id;

    CREATE TABLE real_data_ingest_requests (
      id serial PRIMARY KEY,
      idempotency_key text,
      remote_ip text NOT NULL,
      source_channel text NOT NULL DEFAULT 'EXTERNAL_API',
      received_files integer NOT NULL DEFAULT 0,
      total_bytes integer NOT NULL DEFAULT 0,
      status text NOT NULL DEFAULT 'PROCESSING',
      http_status integer,
      response jsonb,
      created_at timestamptz NOT NULL DEFAULT now(),
      completed_at timestamptz
    );
    CREATE UNIQUE INDEX real_data_ingest_idempotency_idx ON real_data_ingest_requests(idempotency_key);

    CREATE TABLE real_data_ingest_audit (
      id serial PRIMARY KEY,
      request_id integer REFERENCES real_data_ingest_requests(id),
      batch_id integer REFERENCES import_batches(id),
      source_channel text NOT NULL DEFAULT 'EXTERNAL_API',
      remote_ip text NOT NULL,
      filename text NOT NULL,
      file_size integer NOT NULL,
      sha256 text,
      result text NOT NULL,
      idempotency_key text,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE INDEX real_data_ingest_audit_request_idx ON real_data_ingest_audit(request_id, created_at DESC);
    CREATE INDEX real_data_ingest_audit_batch_idx ON real_data_ingest_audit(batch_id);
    INSERT INTO schema_migrations(version) VALUES ('0012_external_ingest_api');
  END IF;
END
$migration$;
