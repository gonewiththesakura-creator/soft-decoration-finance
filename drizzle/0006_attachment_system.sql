CREATE TABLE IF NOT EXISTS attachments (
  id serial PRIMARY KEY,
  company_id integer NOT NULL REFERENCES companies(id),
  project_id integer REFERENCES projects(id),
  object_type text NOT NULL,
  object_id integer NOT NULL,
  category text NOT NULL,
  filename text NOT NULL,
  original_filename text NOT NULL,
  mime_type text NOT NULL,
  file_size integer NOT NULL CHECK (file_size > 0),
  storage_key text NOT NULL UNIQUE,
  url text NOT NULL,
  uploaded_by integer NOT NULL REFERENCES users(id),
  is_void boolean NOT NULL DEFAULT false,
  void_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by integer
);
CREATE INDEX IF NOT EXISTS attachments_object_idx ON attachments(object_type, object_id) WHERE NOT is_void;
CREATE INDEX IF NOT EXISTS attachments_company_project_idx ON attachments(company_id, project_id);
