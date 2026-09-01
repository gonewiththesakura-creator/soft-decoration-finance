-- Persistent login audit and rate-limit source.
CREATE TABLE IF NOT EXISTS login_attempts (
  id serial PRIMARY KEY,
  email text NOT NULL,
  ip text NOT NULL,
  user_id integer REFERENCES users(id),
  success boolean NOT NULL DEFAULT false,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS login_attempts_rate_idx ON login_attempts(email, ip, attempted_at);
