'use strict';
/**
 * Database access for maintenance requests. SQL only — the rules live in
 * maintenance.service.js. Every value is passed as a parameter (NFR-04).
 * Functions that change data take a `client` so the caller can run them
 * inside one transaction.
 */
const db = require('../../db/pool');

/** FR-17: units the resident lives in today (start date passed, no end date or end date not passed). */
async function activeUnitsOf(residentId) {
  const { rows } = await db.query(
    `SELECT u.id, u.unit_number, o.occupancy_type
       FROM occupancies o
       JOIN units u ON u.id = o.unit_id
      WHERE o.resident_id = $1
        AND o.start_date <= CURRENT_DATE
        AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)
      ORDER BY u.unit_number`,
    [residentId],
  );
  return rows.map((r) => ({ id: Number(r.id), unitNumber: r.unit_number, occupancyType: r.occupancy_type }));
}

/** Inserts a request; the database fills in the number, status and submission time. */
async function insertRequest(client, r) {
  const { rows } = await client.query(
    `INSERT INTO maintenance_requests (building_id, title, description, category, location, unit_id, submitted_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [r.buildingId, r.title, r.description, r.category, r.location, r.unitId, r.submittedBy],
  );
  return Number(rows[0].id);
}

/** Adds one history entry (FR-20). History is only ever added to, never changed. */
async function insertUpdate(client, u) {
  await client.query(
    `INSERT INTO request_updates (request_id, author_id, kind, from_status, to_status, note, is_internal)
     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
    [u.requestId, u.authorId ?? null, u.kind, u.fromStatus ?? null, u.toStatus ?? null, u.note ?? null, Boolean(u.isInternal)],
  );
}

/** One request with its unit number and the names of the people involved. */
async function findById(id, client = db) {
  const { rows } = await client.query(
    `SELECT r.*, u.unit_number, s.full_name AS submitted_by_name, a.full_name AS assigned_to_name
       FROM maintenance_requests r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN users s ON s.id = r.submitted_by
       LEFT JOIN users a ON a.id = r.assigned_to
      WHERE r.id = $1`,
    [id],
  );
  return rows[0] || null;
}

module.exports = { activeUnitsOf, insertRequest, insertUpdate, findById };
