'use strict';
/**
 * Database access for bills, charges and payments. SQL only — no business rules here.
 *
 * Shared definitions (the dashboard uses the same ones):
 *   total   = sum of the bill's charges
 *   paid    = sum of the bill's payments (0 if none)
 *   balance = total - paid
 *   status  = 'paid' if total > 0 and paid >= total,
 *             'overdue' if not paid and due_date < today, else 'unpaid'
 *
 * Functions that take `client` run inside a transaction started by the route
 * (db.withTransaction). The others use the normal pool.
 */
const db = require('../../db/pool');

// One row per bill with total, paid and status worked out from the charges and
// payments tables, so they can never be out of date. Callers wrap it:
//   SELECT ... FROM (${BILL_VIEW}) v WHERE ...
const BILL_VIEW = `
  SELECT t.*,
    CASE
      WHEN t.total > 0 AND t.paid >= t.total THEN 'paid'
      WHEN t.due_date < CURRENT_DATE         THEN 'overdue'
      ELSE 'unpaid'
    END AS status
  FROM (
    SELECT b.id, b.building_id, b.unit_id, u.unit_number, b.bill_type, b.bill_month, b.due_date,
      COALESCE((SELECT SUM(c.amount) FROM bill_charges c WHERE c.bill_id = b.id), 0)::int AS total,
      COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.bill_id = b.id), 0)::int AS paid
    FROM bills b
    JOIN units u ON u.id = b.unit_id
  ) t`;

// Dates are turned into 'YYYY-MM-DD' text so they reach the browser exactly as stored.
const BILL_COLUMNS = `
  v.id, v.unit_number, v.bill_type,
  to_char(v.bill_month, 'YYYY-MM-DD') AS bill_month,
  to_char(v.due_date, 'YYYY-MM-DD') AS due_date,
  v.total, v.paid, v.total - v.paid AS balance, v.status`;

// Units a resident currently lives in ($1 is the resident id).
const RESIDENT_UNITS = `
  SELECT o.unit_id FROM occupancies o
   WHERE o.resident_id = $1
     AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)`;

function toBill(row) {
  return {
    id: Number(row.id),
    unitNumber: row.unit_number,
    billType: row.bill_type,
    billMonth: row.bill_month,
    dueDate: row.due_date,
    total: row.total,
    paid: row.paid,
    balance: row.balance,
    status: row.status,
  };
}

function toPayment(row) {
  return {
    id: Number(row.id),
    billId: Number(row.bill_id),
    unitNumber: row.unit_number,
    billType: row.bill_type,
    billMonth: row.bill_month,
    amount: row.amount,
    method: row.method,
    paidOn: row.paid_on,
    recordedBy: row.recorded_by_name,
  };
}

// ---------- Bills ----------

/** Every bill in the building, newest month first (for the admin). */
async function listAll(buildingId) {
  const { rows } = await db.query(
    `SELECT ${BILL_COLUMNS} FROM (${BILL_VIEW}) v
      WHERE v.building_id = $1
      ORDER BY v.bill_month DESC, v.unit_number, v.id DESC`,
    [buildingId],
  );
  return rows.map(toBill);
}

/** Bills for the units a resident currently lives in. */
async function listForResident(residentId) {
  const { rows } = await db.query(
    `SELECT ${BILL_COLUMNS} FROM (${BILL_VIEW}) v
      WHERE v.unit_id IN (${RESIDENT_UNITS})
      ORDER BY v.bill_month DESC, v.unit_number, v.id DESC`,
    [residentId],
  );
  return rows.map(toBill);
}

/**
 * One bill, or null. Pass residentId to limit it to that resident's own units
 * (admin passes null), so other people's bills look like they do not exist.
 */
async function findById(id, buildingId, residentId) {
  const { rows } = await db.query(
    `SELECT ${BILL_COLUMNS} FROM (${BILL_VIEW}) v
      WHERE v.id = $1 AND v.building_id = $2
        AND ($3::bigint IS NULL OR v.unit_id IN (SELECT o.unit_id FROM occupancies o
              WHERE o.resident_id = $3 AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)))`,
    [id, buildingId, residentId],
  );
  return rows[0] ? toBill(rows[0]) : null;
}

/** The charges that make up a bill, oldest first. */
async function listCharges(billId) {
  const { rows } = await db.query(
    'SELECT id, charge_type, description, amount FROM bill_charges WHERE bill_id = $1 ORDER BY id',
    [billId],
  );
  return rows.map((r) => ({ id: Number(r.id), chargeType: r.charge_type, description: r.description, amount: r.amount }));
}

/** The payments made on a bill, oldest first. */
async function listPaymentsForBill(billId) {
  const { rows } = await db.query(
    `SELECT p.id, p.bill_id, p.amount, p.method, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on,
            r.full_name AS recorded_by_name
       FROM payments p
       JOIN users r ON r.id = p.recorded_by
      WHERE p.bill_id = $1
      ORDER BY p.paid_on, p.id`,
    [billId],
  );
  return rows.map(toPayment);
}

/** Creates a bill and its first charge. Returns the new bill id. Throws code 23505 on a duplicate. */
async function createBillWithCharge(client, { buildingId, unitId, billType, billMonth, dueDate, amount, description, createdBy }) {
  const { rows } = await client.query(
    `INSERT INTO bills (building_id, unit_id, bill_type, bill_month, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [buildingId, unitId, billType, billMonth, dueDate, createdBy],
  );
  const billId = Number(rows[0].id);
  await client.query(
    'INSERT INTO bill_charges (bill_id, charge_type, description, amount) VALUES ($1, $2, $3, $4)',
    [billId, billType, description, amount],
  );
  return billId;
}

/** Units that someone lives in right now (for generating monthly bills). */
async function listOccupiedUnits(client, buildingId) {
  const { rows } = await client.query(
    `SELECT u.id, u.unit_number FROM units u
      WHERE u.building_id = $1
        AND EXISTS (SELECT 1 FROM occupancies o
                     WHERE o.unit_id = u.id AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE))
      ORDER BY u.unit_number`,
    [buildingId],
  );
  return rows.map((r) => ({ id: Number(r.id), unitNumber: r.unit_number }));
}

/** True if the unit already has a bill of this type for this month. */
async function billExists(client, unitId, billType, billMonth) {
  const { rows } = await client.query(
    'SELECT 1 FROM bills WHERE unit_id = $1 AND bill_type = $2 AND bill_month = $3',
    [unitId, billType, billMonth],
  );
  return rows.length > 0;
}

/** Locks the bill row until the transaction ends, so two admins cannot change it at once. */
async function lockBill(client, billId, buildingId) {
  const { rows } = await client.query(
    'SELECT id FROM bills WHERE id = $1 AND building_id = $2 FOR UPDATE',
    [billId, buildingId],
  );
  return rows.length > 0;
}

/** Current total and paid for a bill (read inside the transaction, after lockBill). */
async function getTotals(client, billId) {
  const { rows } = await client.query(
    `SELECT COALESCE((SELECT SUM(amount) FROM bill_charges WHERE bill_id = $1), 0)::int AS total,
            COALESCE((SELECT SUM(amount) FROM payments WHERE bill_id = $1), 0)::int AS paid`,
    [billId],
  );
  return rows[0];
}

// ---------- Charges ----------

async function addCharge(client, { billId, chargeType, description, amount }) {
  await client.query(
    'INSERT INTO bill_charges (bill_id, charge_type, description, amount) VALUES ($1, $2, $3, $4)',
    [billId, chargeType, description, amount],
  );
}

/** One charge of a bill, or null. */
async function findCharge(client, billId, chargeId) {
  const { rows } = await client.query(
    'SELECT id, amount FROM bill_charges WHERE id = $1 AND bill_id = $2',
    [chargeId, billId],
  );
  return rows[0] || null;
}

async function deleteCharge(client, chargeId) {
  await client.query('DELETE FROM bill_charges WHERE id = $1', [chargeId]);
}

// ---------- Payments ----------

/** Records one payment (can be part of the bill). Returns the new payment id. */
async function createPayment(client, { billId, amount, method, paidOn, recordedBy }) {
  const { rows } = await client.query(
    `INSERT INTO payments (bill_id, amount, method, paid_on, recorded_by)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [billId, amount, method, paidOn, recordedBy],
  );
  return Number(rows[0].id);
}

const PAYMENT_COLUMNS = `
  p.id, p.bill_id, p.amount, p.method, to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on,
  b.bill_type, to_char(b.bill_month, 'YYYY-MM-DD') AS bill_month,
  u.unit_number, r.full_name AS recorded_by_name`;

const PAYMENT_FROM = `
  FROM payments p
  JOIN bills b ON b.id = p.bill_id
  JOIN units u ON u.id = b.unit_id
  JOIN users r ON r.id = p.recorded_by`;

/** Every payment in the building, newest first (for the admin). */
async function listAllPayments(buildingId) {
  const { rows } = await db.query(
    `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
      WHERE b.building_id = $1
      ORDER BY p.paid_on DESC, p.id DESC`,
    [buildingId],
  );
  return rows.map(toPayment);
}

/** Payments on the units a resident currently lives in. */
async function listPaymentsForResident(residentId) {
  const { rows } = await db.query(
    `SELECT ${PAYMENT_COLUMNS} ${PAYMENT_FROM}
      WHERE b.unit_id IN (${RESIDENT_UNITS})
      ORDER BY p.paid_on DESC, p.id DESC`,
    [residentId],
  );
  return rows.map(toPayment);
}

/** One payment with everything a receipt shows, or null. residentId limits it to that resident's units. */
async function findPaymentForReceipt(id, buildingId, residentId) {
  const { rows } = await db.query(
    `SELECT ${PAYMENT_COLUMNS}, bd.name AS building_name,
            COALESCE((SELECT string_agg(ru.full_name, ', ' ORDER BY ru.full_name)
                        FROM occupancies o JOIN users ru ON ru.id = o.resident_id
                       WHERE o.unit_id = b.unit_id
                         AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)), '') AS resident_names
       ${PAYMENT_FROM}
       JOIN buildings bd ON bd.id = b.building_id
      WHERE p.id = $1 AND b.building_id = $2
        AND ($3::bigint IS NULL OR b.unit_id IN (SELECT o.unit_id FROM occupancies o
              WHERE o.resident_id = $3 AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)))`,
    [id, buildingId, residentId],
  );
  if (!rows[0]) return null;
  return { ...toPayment(rows[0]), buildingName: rows[0].building_name, residentNames: rows[0].resident_names };
}

// ---------- Report (FR-15) ----------

/**
 * Totals for the report. fromMonth / toMonth are 'YYYY-MM' or null (null = no limit).
 *   billed      = charges on bills whose month is in the range
 *   collected   = payments whose paid_on date is in the range
 *   outstanding = balance of the not-paid bills whose month is in the range
 */
async function getSummary(buildingId, fromMonth, toMonth) {
  const from = fromMonth ? `${fromMonth}-01` : null;
  const to = toMonth ? `${toMonth}-01` : null;

  const bills = await db.query(
    `SELECT COALESCE(SUM(v.total), 0)::int AS billed,
            COALESCE(SUM(CASE WHEN v.status <> 'paid' THEN v.total - v.paid ELSE 0 END), 0)::int AS outstanding
       FROM (${BILL_VIEW}) v
      WHERE v.building_id = $1
        AND ($2::date IS NULL OR v.bill_month >= $2::date)
        AND ($3::date IS NULL OR v.bill_month <= $3::date)`,
    [buildingId, from, to],
  );

  // The end of the range is the last day of the "to" month.
  const payments = await db.query(
    `SELECT COALESCE(SUM(p.amount), 0)::int AS collected
       FROM payments p
       JOIN bills b ON b.id = p.bill_id
      WHERE b.building_id = $1
        AND ($2::date IS NULL OR p.paid_on >= $2::date)
        AND ($3::date IS NULL OR p.paid_on < $3::date + INTERVAL '1 month')`,
    [buildingId, from, to],
  );

  return {
    billed: bills.rows[0].billed,
    collected: payments.rows[0].collected,
    outstanding: bills.rows[0].outstanding,
  };
}

/** Units that still owe money today (all time), biggest debt first. */
async function listUnitsWithDues(buildingId) {
  const { rows } = await db.query(
    `SELECT v.unit_id, v.unit_number,
            COUNT(*)::int AS unpaid_bills,
            SUM(v.total - v.paid)::int AS amount_owed,
            to_char(MIN(v.due_date), 'YYYY-MM-DD') AS oldest_due_date,
            COALESCE((SELECT string_agg(ru.full_name, ', ' ORDER BY ru.full_name)
                        FROM occupancies o JOIN users ru ON ru.id = o.resident_id
                       WHERE o.unit_id = v.unit_id
                         AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)), '') AS resident_names
       FROM (${BILL_VIEW}) v
      WHERE v.building_id = $1 AND v.status <> 'paid' AND v.total - v.paid > 0
      GROUP BY v.unit_id, v.unit_number
      ORDER BY amount_owed DESC, v.unit_number`,
    [buildingId],
  );
  return rows.map((r) => ({
    unitNumber: r.unit_number,
    residentNames: r.resident_names,
    unpaidBills: r.unpaid_bills,
    amountOwed: r.amount_owed,
    oldestDueDate: r.oldest_due_date,
  }));
}

// ---------- Units ----------

/** Units in the building, for the "Create a bill" form. */
async function listUnits(buildingId) {
  const { rows } = await db.query(
    'SELECT id, unit_number FROM units WHERE building_id = $1 ORDER BY unit_number',
    [buildingId],
  );
  return rows.map((r) => ({ id: Number(r.id), unitNumber: r.unit_number }));
}

/** True if the unit exists in this building. */
async function unitExists(unitId, buildingId) {
  const { rows } = await db.query('SELECT 1 FROM units WHERE id = $1 AND building_id = $2', [unitId, buildingId]);
  return rows.length > 0;
}

module.exports = {
  listAll, listForResident, findById, listCharges, listPaymentsForBill,
  createBillWithCharge, listOccupiedUnits, billExists, lockBill, getTotals,
  addCharge, findCharge, deleteCharge,
  createPayment, listAllPayments, listPaymentsForResident, findPaymentForReceipt,
  getSummary, listUnitsWithDues, listUnits, unitExists,
};
