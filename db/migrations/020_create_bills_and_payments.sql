-- 020_create_bills_and_payments.sql
-- Billing and payment management (basic version).
--
-- The admin creates a bill for a unit (for example "Service charge - November").
-- When the resident pays, the admin records the payment.
-- A bill is paid in full with one payment; there are no partial payments yet.
--
-- Numbered 020 so it does not clash with the maintenance migrations (002-019).

CREATE TABLE bills (
  id           BIGSERIAL PRIMARY KEY,
  building_id  INT NOT NULL DEFAULT 1 REFERENCES buildings(id),
  unit_id      BIGINT NOT NULL REFERENCES units(id),
  title        TEXT NOT NULL CHECK (length(trim(title)) > 0),  -- e.g. "Service charge - November 2026"
  amount       INT NOT NULL CHECK (amount > 0),                -- in whole taka
  due_date     DATE NOT NULL,
  created_by   BIGINT NOT NULL REFERENCES users(id),           -- the admin who created it
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bills_unit_idx ON bills (unit_id);

-- One row per paid bill. A bill with no payment row is unpaid.
CREATE TABLE payments (
  id           BIGSERIAL PRIMARY KEY,
  bill_id      BIGINT NOT NULL UNIQUE REFERENCES bills(id),    -- UNIQUE: a bill can only be paid once
  amount       INT NOT NULL CHECK (amount > 0),
  method       TEXT NOT NULL CHECK (method IN ('cash', 'bkash', 'bank')),
  paid_on      DATE NOT NULL,
  recorded_by  BIGINT NOT NULL REFERENCES users(id),           -- the admin who recorded it
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
