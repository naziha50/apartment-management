-- 001_create_users_and_units.sql
-- People and apartments that maintenance requests belong to (SRS §2.3, §7.1).
--
-- Login is not part of the current scope, so there is no password column yet;
-- a later migration adds it when authentication (FR-01) is built.
-- Every table holding building data has building_id so the system can later
-- serve more than one building without a redesign (NFR-26).

CREATE EXTENSION IF NOT EXISTS btree_gist; -- needed for the "no overlapping occupancies" rule (BR-06)

CREATE TABLE buildings (
  id          SERIAL PRIMARY KEY,
  name        TEXT NOT NULL,
  address     TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Three user classes (SRS §2.3). There is no separate maintenance-worker role.
CREATE TYPE user_role AS ENUM ('resident', 'staff', 'admin');

CREATE TABLE users (
  id           BIGSERIAL PRIMARY KEY,
  building_id  INT NOT NULL DEFAULT 1 REFERENCES buildings(id),
  role         user_role NOT NULL,
  full_name    TEXT NOT NULL CHECK (length(trim(full_name)) > 0), -- Bangla names allowed (§2.6)
  email        TEXT,
  phone        TEXT CHECK (phone IS NULL OR phone ~ '^\+8801[0-9]{9}$'),  -- stored as +8801XXXXXXXXX (BR-01)
  is_active    BOOLEAN NOT NULL DEFAULT TRUE,                            -- deactivated users keep their history (BR-03)
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (email IS NOT NULL OR phone IS NOT NULL)                         -- every user needs one contact / future login ID
  -- No national ID column on purpose (NFR-25).
);
CREATE UNIQUE INDEX users_email_uq ON users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX users_phone_uq ON users (phone) WHERE phone IS NOT NULL;
CREATE INDEX users_building_role_idx ON users (building_id, role) WHERE is_active;

-- Staff can only do what the admin grants (Appendix B). Only the maintenance
-- permissions are needed for now; more are added with their modules.
CREATE TABLE staff_permissions (
  user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  permission  TEXT NOT NULL CHECK (permission IN (
    'maintenance.view_all',   -- see every request, not just assigned ones
    'maintenance.review',     -- review, prioritise, reject
    'maintenance.assign'      -- assign requests to staff
  )),
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, permission)
);

CREATE TABLE units (
  id              BIGSERIAL PRIMARY KEY,
  building_id     INT NOT NULL DEFAULT 1 REFERENCES buildings(id),
  unit_number     TEXT NOT NULL CHECK (length(trim(unit_number)) > 0),
  floor           INT,
  size_sqft       INT CHECK (size_sqft IS NULL OR size_sqft > 0),
  bedrooms        INT CHECK (bedrooms IS NULL OR bedrooms >= 0),
  is_unavailable  BOOLEAN NOT NULL DEFAULT FALSE,  -- e.g. under renovation; Occupied/Vacant is calculated (BR-05)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- "4b" and "4B" are the same unit (BR-04).
CREATE UNIQUE INDEX units_number_uq ON units (building_id, lower(unit_number));

-- Who lives where, and when (SRS §1.5 "Occupancy"). No end date = active.
CREATE TABLE occupancies (
  id              BIGSERIAL PRIMARY KEY,
  building_id     INT NOT NULL DEFAULT 1 REFERENCES buildings(id),
  unit_id         BIGINT NOT NULL REFERENCES units(id),
  resident_id     BIGINT NOT NULL REFERENCES users(id),
  occupancy_type  TEXT NOT NULL CHECK (occupancy_type IN ('owner', 'tenant')),
  start_date      DATE NOT NULL,
  end_date        DATE,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (end_date IS NULL OR end_date >= start_date),          -- BR-06
  EXCLUDE USING gist (                                           -- BR-06: same resident, same unit, no overlap
    unit_id WITH =, resident_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
);
CREATE INDEX occupancies_resident_idx ON occupancies (resident_id);
CREATE INDEX occupancies_unit_idx ON occupancies (unit_id);
