-- 009_create_scheduled_tasks.sql
-- Recurring maintenance jobs such as monthly lift servicing (FR-49, BR-25).
-- The job that turns a task into a request 7 days before it is due comes in the next migration.

CREATE TABLE scheduled_tasks (
  id                BIGSERIAL PRIMARY KEY,
  building_id       INT NOT NULL DEFAULT 1 REFERENCES buildings(id),               -- NFR-26
  title             TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 120),     -- same limits as a request
  description       TEXT CHECK (description IS NULL OR length(trim(description)) BETWEEN 1 AND 4000),
  category          TEXT NOT NULL CHECK (category IN (                              -- FR-16 categories
                      'plumbing', 'electrical', 'lift', 'generator', 'water_supply',
                      'gas', 'cleaning', 'security', 'common_area', 'other')),
  interval_months   SMALLINT NOT NULL CHECK (interval_months BETWEEN 1 AND 24),      -- BR-25
  next_due_date     DATE NOT NULL,                                                   -- a Bangladesh calendar day
  default_assignee  BIGINT REFERENCES users(id),                                     -- optional (BR-25)
  is_paused         BOOLEAN NOT NULL DEFAULT FALSE,                                  -- paused tasks create nothing
  created_by        BIGINT NOT NULL REFERENCES users(id),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- The list (soonest first) and the daily "what is due" check read active tasks by date.
CREATE INDEX scheduled_tasks_due_idx ON scheduled_tasks (building_id, next_due_date) WHERE NOT is_paused;
