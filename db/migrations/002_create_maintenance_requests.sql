-- 002_create_maintenance_requests.sql
-- Maintenance requests and their history (SRS §4.3, BR-16, Appendix A, §7.2, §7.3).
--
-- Photos (BR-19), assignment history (FR-19) and ratings (BR-26) get their own
-- tables in later migrations, when those features are built.

-- The seven statuses a request can be in (BR-16). Closed, Rejected and Cancelled are final.
CREATE TYPE request_status AS ENUM (
  'submitted', 'under_review', 'in_progress', 'resolved', 'closed', 'rejected', 'cancelled'
);

-- Set by the admin or a permitted staff member when reviewing (FR-18). NULL = not set yet.
CREATE TYPE request_priority AS ENUM ('low', 'medium', 'high');

-- Running number for request numbers like MR-2026-00001.
CREATE SEQUENCE maintenance_request_number_seq;

CREATE TABLE maintenance_requests (
  id                BIGSERIAL PRIMARY KEY,
  building_id       INT NOT NULL DEFAULT 1 REFERENCES buildings(id),            -- NFR-26
  request_number    TEXT NOT NULL UNIQUE DEFAULT (
                      'MR-' || to_char(now(), 'YYYY') || '-' ||
                      lpad(nextval('maintenance_request_number_seq')::text, 5, '0')),
  title             TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 3 AND 120),
  description       TEXT NOT NULL CHECK (length(trim(description)) BETWEEN 1 AND 4000),
  category          TEXT NOT NULL CHECK (category IN (                           -- FR-16
                      'plumbing', 'electrical', 'lift', 'generator', 'water_supply',
                      'gas', 'cleaning', 'security', 'common_area', 'other')),
  location          TEXT NOT NULL CHECK (location IN ('unit', 'common_area')),  -- FR-16: my unit or a common area
  unit_id           BIGINT REFERENCES units(id),                                -- FR-17: the resident's unit
  submitted_by      BIGINT REFERENCES users(id),                                -- FR-17; NULL only for "System" requests (BR-25)
  status            request_status NOT NULL DEFAULT 'submitted',
  priority          request_priority,
  assigned_to       BIGINT REFERENCES users(id),                                -- FR-19
  rejection_reason  TEXT,                                                       -- FR-18
  resolution_note   TEXT,                                                       -- FR-20
  submitted_at      TIMESTAMPTZ NOT NULL DEFAULT now(),                         -- FR-17
  reviewed_at       TIMESTAMPTZ,
  resolved_at       TIMESTAMPTZ,                                                -- starts the 7-day reopen/auto-close window (BR-18)
  closed_at         TIMESTAMPTZ,
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- A rejected request always says why; a resolved or closed one says how it was fixed.
  CHECK (status <> 'rejected' OR rejection_reason IS NOT NULL),
  CHECK (status NOT IN ('resolved', 'closed') OR resolution_note IS NOT NULL OR submitted_by IS NULL)
);

-- Indexes for the lists and filters (NFR-18).
CREATE INDEX maintenance_requests_status_idx       ON maintenance_requests (building_id, status, submitted_at);
CREATE INDEX maintenance_requests_submitted_by_idx ON maintenance_requests (submitted_by);
CREATE INDEX maintenance_requests_assigned_to_idx  ON maintenance_requests (assigned_to) WHERE assigned_to IS NOT NULL;
CREATE INDEX maintenance_requests_unit_idx         ON maintenance_requests (unit_id);

-- History: every status change and progress note, in order (FR-20, FR-21).
-- Rows are only ever added, never edited or deleted (§7.2 keeps them permanently).
CREATE TABLE request_updates (
  id           BIGSERIAL PRIMARY KEY,
  request_id   BIGINT NOT NULL REFERENCES maintenance_requests(id),
  author_id    BIGINT REFERENCES users(id),           -- NULL = "System" (e.g. auto-close, BR-18)
  kind         TEXT NOT NULL CHECK (kind IN ('status_change', 'note', 'priority', 'assignment')),
  from_status  request_status,
  to_status    request_status,
  note         TEXT CHECK (note IS NULL OR length(note) <= 2000),
  is_internal  BOOLEAN NOT NULL DEFAULT FALSE,         -- hidden from the resident (FR-20)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (kind <> 'status_change' OR to_status IS NOT NULL),
  CHECK (kind <> 'note' OR note IS NOT NULL)
);
CREATE INDEX request_updates_request_idx ON request_updates (request_id, created_at);
