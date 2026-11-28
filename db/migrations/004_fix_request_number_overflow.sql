-- 004_fix_request_number_overflow.sql
-- Request numbers keep working after request 99,999 (FR-16, NFR-14).
--
-- Migration 002 built the number with lpad(n, 5, '0'). lpad does not only pad:
-- it also CUTS longer text, so request 100000 became "MR-YYYY-10000", the same
-- number as request 10000, and saving it failed. The counter is shared by every
-- building and never restarts, so this is a total, not a yearly, limit.
--
-- Now numbers keep at least 5 digits and are never cut:
--   MR-2026-00001 … MR-2026-99999, then MR-2026-100000, MR-2026-100001 …
-- Existing numbers are not changed.

CREATE FUNCTION next_request_number() RETURNS text
LANGUAGE sql VOLATILE AS $$
  SELECT 'MR-' || to_char(now(), 'YYYY') || '-' || lpad(n::text, greatest(5, length(n::text)), '0')
  FROM (SELECT nextval('maintenance_request_number_seq') AS n) AS next_value
$$;

ALTER TABLE maintenance_requests ALTER COLUMN request_number SET DEFAULT next_request_number();
