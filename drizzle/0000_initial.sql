-- The executable source of this migration is src/db/migration.ts.
-- It is kept there so the zero-config embedded PostgreSQL runtime and tests
-- apply the exact same idempotent migration at startup.
\i ../src/db/migration.sql
