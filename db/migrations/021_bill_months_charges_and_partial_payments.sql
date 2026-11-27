-- 021_bill_months_charges_and_partial_payments.sql
-- Finishes billing:
--   FR-09: every bill is for one month and one type, and a unit cannot get two
--          bills of the same type for the same month.
--   FR-10: a bill is made of charges (rent, utilities, other fees). The bill
--          total is the sum of its charges, so it is never out of date.
--   FR-11: a bill can be paid in parts. Each payment lowers the balance.

-- FR-09: bill type and month. bill_month is always the 1st day of the month.
ALTER TABLE bills ADD COLUMN bill_type TEXT NOT NULL DEFAULT 'service_charge'
  CHECK (bill_type IN ('service_charge', 'rent', 'utility', 'other'));
ALTER TABLE bills ADD COLUMN bill_month DATE;

-- Fill the new columns for bills that already exist.
UPDATE bills SET
  bill_month = date_trunc('month', due_date)::date,
  bill_type  = CASE WHEN title ILIKE '%service%' THEN 'service_charge' ELSE 'other' END;

ALTER TABLE bills ALTER COLUMN bill_month SET NOT NULL;
ALTER TABLE bills ADD CHECK (extract(day FROM bill_month) = 1);
ALTER TABLE bills ADD CONSTRAINT bills_one_per_type_and_month UNIQUE (unit_id, bill_type, bill_month);

-- FR-10: the charges that make up a bill.
CREATE TABLE bill_charges (
  id           BIGSERIAL PRIMARY KEY,
  bill_id      BIGINT NOT NULL REFERENCES bills(id),
  charge_type  TEXT NOT NULL CHECK (charge_type IN ('service_charge', 'rent', 'utility', 'other')),
  description  TEXT NOT NULL CHECK (length(trim(description)) > 0),
  amount       INT NOT NULL CHECK (amount > 0),                -- in whole taka
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX bill_charges_bill_idx ON bill_charges (bill_id);

-- Every existing bill becomes a bill with one charge for its old amount.
INSERT INTO bill_charges (bill_id, charge_type, description, amount)
SELECT id, bill_type, title, amount FROM bills;

-- The total now comes from the charges, and the label from type + month.
ALTER TABLE bills DROP COLUMN amount;
ALTER TABLE bills DROP COLUMN title;

-- FR-11: allow more than one payment per bill (partial payments).
ALTER TABLE payments DROP CONSTRAINT payments_bill_id_key;
CREATE INDEX payments_bill_idx ON payments (bill_id);
