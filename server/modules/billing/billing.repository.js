'use strict';
/** Database access for bills and payments. SQL only — no business rules here. */
const db = require('../../db/pool');

// Columns every bill query returns. Dates are turned into 'YYYY-MM-DD' text so
// they reach the browser exactly as stored, with no time-zone shift.
// status is worked out from the payments table, so it can never be out of date.
const BILL_COLUMNS = `
  b.id, b.title, b.amount,
  to_char(b.due_date, 'YYYY-MM-DD') AS due_date,
  u.unit_number,
  p.method,
  to_char(p.paid_on, 'YYYY-MM-DD') AS paid_on,
  CASE
    WHEN p.id IS NOT NULL         THEN 'paid'
    WHEN b.due_date < CURRENT_DATE THEN 'overdue'
    ELSE 'unpaid'
  END AS status`;

const BILL_FROM = `
  FROM bills b
  JOIN units u ON u.id = b.unit_id
  LEFT JOIN payments p ON p.bill_id = b.id`;

function toBill(row) {
  return {
    id: Number(row.id),
    title: row.title,
    amount: row.amount,
    dueDate: row.due_date,
    unitNumber: row.unit_number,
    status: row.status,
    paymentMethod: row.method,
    paidOn: row.paid_on,
  };
}

/** Every bill in the building, newest due date first (for the admin). */
async function listAll(buildingId) {
  const { rows } = await db.query(
    `SELECT ${BILL_COLUMNS} ${BILL_FROM}
      WHERE b.building_id = $1
      ORDER BY b.due_date DESC, b.id DESC`,
    [buildingId],
  );
  return rows.map(toBill);
}

/** Bills for the units a resident currently lives in. */
async function listForResident(residentId) {
  const { rows } = await db.query(
    `SELECT ${BILL_COLUMNS} ${BILL_FROM}
      WHERE b.unit_id IN (
        SELECT o.unit_id FROM occupancies o
         WHERE o.resident_id = $1
           AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)
      )
      ORDER BY b.due_date DESC, b.id DESC`,
    [residentId],
  );
  return rows.map(toBill);
}

/** One bill, or null if it does not exist in this building. */
async function findById(id, buildingId) {
  const { rows } = await db.query(
    `SELECT ${BILL_COLUMNS} ${BILL_FROM} WHERE b.id = $1 AND b.building_id = $2`,
    [id, buildingId],
  );
  return rows[0] ? toBill(rows[0]) : null;
}

/** Creates a bill and returns its id. */
async function createBill({ buildingId, unitId, title, amount, dueDate, createdBy }) {
  const { rows } = await db.query(
    `INSERT INTO bills (building_id, unit_id, title, amount, due_date, created_by)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [buildingId, unitId, title, amount, dueDate, createdBy],
  );
  return Number(rows[0].id);
}

/** Records the payment for a bill. The amount is always the full bill amount. */
async function createPayment({ billId, method, paidOn, recordedBy }) {
  await db.query(
    `INSERT INTO payments (bill_id, amount, method, paid_on, recorded_by)
     SELECT id, amount, $2, $3, $4 FROM bills WHERE id = $1`,
    [billId, method, paidOn, recordedBy],
  );
}

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

module.exports = { listAll, listForResident, findById, createBill, createPayment, listUnits, unitExists };
