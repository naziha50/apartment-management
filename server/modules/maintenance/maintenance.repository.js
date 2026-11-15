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

/**
 * Requests in a building, newest activity first (FR-21).
 * `scope` narrows it: { submittedBy } for residents, { assignedTo } for staff.
 * shortcut: capped at 200 rows with no paging; add paging with the filters of FR-22.
 */
async function listRequests(buildingId, scope = {}) {
  const params = [buildingId];
  const where = ['r.building_id = $1'];
  if (scope.submittedBy) {
    params.push(scope.submittedBy);
    where.push(`r.submitted_by = $${params.length}`);
  }
  if (scope.assignedTo) {
    params.push(scope.assignedTo);
    where.push(`r.assigned_to = $${params.length}`);
  }
  const { rows } = await db.query(
    `SELECT r.*, u.unit_number, s.full_name AS submitted_by_name, a.full_name AS assigned_to_name
       FROM maintenance_requests r
       LEFT JOIN units u ON u.id = r.unit_id
       LEFT JOIN users s ON s.id = r.submitted_by
       LEFT JOIN users a ON a.id = r.assigned_to
      WHERE ${where.join(' AND ')}
      ORDER BY r.updated_at DESC, r.id DESC
      LIMIT 200`,
    params,
  );
  return rows;
}

/** A request's history, oldest first (FR-20). Residents never get internal notes. */
async function listUpdates(requestId, { includeInternal }) {
  const { rows } = await db.query(
    `SELECT ru.id, ru.kind, ru.from_status, ru.to_status, ru.note, ru.is_internal, ru.created_at,
            COALESCE(a.full_name, 'System') AS author_name
       FROM request_updates ru
       LEFT JOIN users a ON a.id = ru.author_id
      WHERE ru.request_id = $1 AND ($2 OR NOT ru.is_internal)
      ORDER BY ru.created_at, ru.id`,
    [requestId, includeInternal],
  );
  return rows;
}

module.exports = { activeUnitsOf, insertRequest, insertUpdate, findById, listRequests, listUpdates };
