'use strict';
/**
 * Dashboard queries (SQL only). Every query is limited to one building and
 * every value is passed as a parameter ($1, $2 ...), never joined into the SQL.
 *
 * Billing definitions (same as the billing report):
 *   total = sum of the bill's charges, paid = sum of its payments,
 *   balance = total - paid, a bill is paid when total > 0 and paid >= total.
 */
const db = require('../../db/pool');

// A bill with its total and paid amounts. Used by the money numbers and by search.
const BILL_TOTALS = `
  SELECT b.id, b.unit_id, b.bill_type, b.due_date,
         to_char(b.bill_month, 'Mon YYYY') AS month_label,
         COALESCE((SELECT SUM(c.amount) FROM bill_charges c WHERE c.bill_id = b.id), 0)::int AS total,
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.bill_id = b.id), 0)::int AS paid
  FROM bills b
  WHERE b.building_id = $1`;

/** True if a table exists (the maintenance and announcements modules may not be merged yet). */
async function tableExists(name) {
  const { rows } = await db.query('SELECT to_regclass($1) AS found', [name]);
  return rows[0].found !== null;
}

// FR-27: unit and resident counts.
async function getOccupancyCounts(buildingId) {
  const { rows } = await db.query(
    `SELECT
       (SELECT COUNT(*) FROM units WHERE building_id = $1)::int AS total_units,
       (SELECT COUNT(DISTINCT o.unit_id) FROM occupancies o
          JOIN units u ON u.id = o.unit_id
         WHERE u.building_id = $1 AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE))::int AS occupied_units,
       (SELECT COUNT(*) FROM users
         WHERE building_id = $1 AND role = 'resident' AND is_active)::int AS residents`,
    [buildingId]
  );
  return rows[0];
}

// FR-28: money collected, money still owed, and bills past their due date.
async function getBillingTotals(buildingId) {
  const { rows } = await db.query(
    `SELECT
       COALESCE((SELECT SUM(p.amount) FROM payments p JOIN bills b ON b.id = p.bill_id
                  WHERE b.building_id = $1), 0)::int AS collected,
       COALESCE(SUM(CASE WHEN NOT (t.total > 0 AND t.paid >= t.total) THEN t.total - t.paid END), 0)::int AS outstanding,
       COUNT(*) FILTER (WHERE NOT (t.total > 0 AND t.paid >= t.total) AND t.due_date < CURRENT_DATE)::int AS overdue_bills
     FROM (${BILL_TOTALS}) t`,
    [buildingId]
  );
  return rows[0];
}

// FR-29: requests per status, plus how many are overdue (open longer than the target hours).
async function getMaintenanceCounts(buildingId) {
  const { rows } = await db.query(
    `SELECT status, COUNT(*)::int AS count
     FROM maintenance_requests WHERE building_id = $1 GROUP BY status`,
    [buildingId]
  );
  const overdue = await db.query(
    `SELECT COUNT(*)::int AS count
     FROM maintenance_requests
     WHERE building_id = $1
       AND status IN ('submitted', 'under_review', 'in_progress')
       AND submitted_at < now() - (CASE priority
             WHEN 'high' THEN 24 WHEN 'medium' THEN 72 WHEN 'low' THEN 168 ELSE 48 END) * interval '1 hour'`,
    [buildingId]
  );
  return { rows, overdue: overdue.rows[0].count };
}

// FR-30: the 10 newest bills created.
async function recentBills(buildingId) {
  const { rows } = await db.query(
    `SELECT u.unit_number, b.bill_type, to_char(b.bill_month, 'Mon YYYY') AS month_label, b.created_at AS at
     FROM bills b JOIN units u ON u.id = b.unit_id
     WHERE b.building_id = $1
     ORDER BY b.created_at DESC LIMIT 10`,
    [buildingId]
  );
  return rows;
}

// FR-30: the 10 newest payments recorded.
async function recentPayments(buildingId) {
  const { rows } = await db.query(
    `SELECT p.amount, p.method, u.unit_number, p.created_at AS at
     FROM payments p JOIN bills b ON b.id = p.bill_id JOIN units u ON u.id = b.unit_id
     WHERE b.building_id = $1
     ORDER BY p.created_at DESC LIMIT 10`,
    [buildingId]
  );
  return rows;
}

// FR-30: the 10 newest maintenance requests.
async function recentRequests(buildingId) {
  const { rows } = await db.query(
    `SELECT request_number, title, submitted_at AS at
     FROM maintenance_requests WHERE building_id = $1
     ORDER BY submitted_at DESC LIMIT 10`,
    [buildingId]
  );
  return rows;
}

// ---------- FR-30 search. `pattern` is already escaped, like %text% ----------

async function searchResidents(buildingId, pattern) {
  const { rows } = await db.query(
    `SELECT u.id, u.full_name, u.email, u.phone,
            (SELECT string_agg(DISTINCT un.unit_number, ', ' ORDER BY un.unit_number)
               FROM occupancies o JOIN units un ON un.id = o.unit_id
              WHERE o.resident_id = u.id AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)) AS units
     FROM users u
     WHERE u.building_id = $1 AND u.role = 'resident'
       AND (u.full_name ILIKE $2 OR u.email ILIKE $2 OR u.phone ILIKE $2)
     ORDER BY u.full_name LIMIT 10`,
    [buildingId, pattern]
  );
  return rows;
}

async function searchUnits(buildingId, pattern) {
  const { rows } = await db.query(
    `SELECT u.id, u.unit_number, u.floor,
            EXISTS (SELECT 1 FROM occupancies o
                     WHERE o.unit_id = u.id AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)) AS occupied
     FROM units u
     WHERE u.building_id = $1 AND u.unit_number ILIKE $2
     ORDER BY u.unit_number LIMIT 10`,
    [buildingId, pattern]
  );
  return rows;
}

async function searchBills(buildingId, pattern) {
  const { rows } = await db.query(
    `SELECT t.id, u.unit_number, t.bill_type, t.month_label, t.total, t.paid, t.due_date < CURRENT_DATE AS past_due
     FROM (${BILL_TOTALS}) t JOIN units u ON u.id = t.unit_id
     WHERE u.unit_number ILIKE $2 OR t.bill_type ILIKE $2 OR replace(t.bill_type, '_', ' ') ILIKE $2
     ORDER BY t.id DESC LIMIT 10`,
    [buildingId, pattern]
  );
  return rows;
}

async function searchRequests(buildingId, pattern) {
  const { rows } = await db.query(
    `SELECT id, request_number, title, status
     FROM maintenance_requests
     WHERE building_id = $1 AND (request_number ILIKE $2 OR title ILIKE $2)
     ORDER BY submitted_at DESC LIMIT 10`,
    [buildingId, pattern]
  );
  return rows;
}

module.exports = {
  tableExists, getOccupancyCounts, getBillingTotals, getMaintenanceCounts,
  recentBills, recentPayments, recentRequests,
  searchResidents, searchUnits, searchBills, searchRequests,
};
