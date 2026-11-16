'use strict';
/**
 * Database access for maintenance requests. SQL only — the rules live in
 * maintenance.service.js. Every value is passed as a parameter (NFR-04).
 * Functions that change data take a `client` so the caller can run them
 * inside one transaction.
 */
const db = require('../../db/pool');
const { NEEDS_ACTION, TARGET_HOURS } = require('./maintenance.constants');

// BR-17 in SQL, for a request aliased `r`; same rule as isOverdue() in state-machine.js.
// The numbers are our own constants (never user input), so they are written into the SQL.
const OVERDUE_SQL = `(r.status IN (${NEEDS_ACTION.map((s) => `'${s}'`).join(', ')})
  AND r.submitted_at + make_interval(hours => CASE r.priority
        WHEN 'high' THEN ${Number(TARGET_HOURS.high)} WHEN 'medium' THEN ${Number(TARGET_HOURS.medium)}
        WHEN 'low' THEN ${Number(TARGET_HOURS.low)} ELSE ${Number(TARGET_HOURS.unset)} END) < now())`;

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
  const { rows } = await client.query(
    `INSERT INTO request_updates (request_id, author_id, kind, from_status, to_status, note, is_internal)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
    [u.requestId, u.authorId ?? null, u.kind, u.fromStatus ?? null, u.toStatus ?? null, u.note ?? null, Boolean(u.isInternal)],
  );
  return Number(rows[0].id);
}

/** One request with its unit number and the names of the people involved. */
async function findById(id) {
  const { rows } = await db.query(
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
 * One page of requests in a building, newest activity first (FR-21, FR-22).
 * `scope` is what the user may see: { submittedBy } for residents, { assignedTo } for staff.
 * `filters` come from the list page: { statuses, category, priority, unassigned, overdue, unitId, assignedTo, from, to, q, sort }.
 * sort 'oldest' puts the longest-waiting first (FR-18 review queue); otherwise newest activity first.
 * Returns { rows, total } where total counts every match, not just this page.
 */
async function listRequests(buildingId, scope = {}, filters = {}, { limit = 20, offset = 0 } = {}) {
  const params = [buildingId];
  const where = ['r.building_id = $1'];
  // Adds a condition; every "?" in it becomes the same new parameter.
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replaceAll('?', `$${params.length}`));
  };
  if (scope.submittedBy) add('r.submitted_by = ?', scope.submittedBy);
  if (scope.assignedTo) add('r.assigned_to = ?', scope.assignedTo);
  if (filters.statuses?.length) add('r.status = ANY(?::request_status[])', filters.statuses);
  if (filters.category) add('r.category = ?', filters.category);
  if (filters.unassigned) where.push('r.assigned_to IS NULL');
  if (filters.overdue) where.push(OVERDUE_SQL);
  if (filters.unitId) add('r.unit_id = ?', filters.unitId);
  if (filters.assignedTo) add('r.assigned_to = ?', filters.assignedTo);
  // FR-22 date range on the submission day in Bangladesh time (§2.6); `to` includes that whole day.
  if (filters.from) add("r.submitted_at >= (?::date)::timestamp AT TIME ZONE 'Asia/Dhaka'", filters.from);
  if (filters.to) add("r.submitted_at < (?::date + 1)::timestamp AT TIME ZONE 'Asia/Dhaka'", filters.to);
  if (filters.priority === 'unset') where.push('r.priority IS NULL');
  else if (filters.priority) add('r.priority = ?::request_priority', filters.priority);
  // % and _ typed by the user are matched literally.
  if (filters.q) add('(r.title ILIKE ? OR r.request_number ILIKE ?)', `%${filters.q.replace(/[\\%_]/g, '\\$&')}%`);

  // The page and the total are two queries on purpose: counting inside the page query
  // (count(*) OVER ()) makes PostgreSQL fetch and sort every match just to show 20.
  // With the index from migration 005 the page reads only its 20 rows (about 12x faster
  // at 100,000 requests); the count is a separate, cheap scan.
  const whereSql = where.join(' AND ');
  const [page, count] = await Promise.all([
    db.query(
      `SELECT r.*, u.unit_number, s.full_name AS submitted_by_name, a.full_name AS assigned_to_name
         FROM maintenance_requests r
         LEFT JOIN units u ON u.id = r.unit_id
         LEFT JOIN users s ON s.id = r.submitted_by
         LEFT JOIN users a ON a.id = r.assigned_to
        WHERE ${whereSql}
        ORDER BY ${filters.sort === 'oldest' ? 'r.submitted_at, r.id' : 'r.updated_at DESC, r.id DESC'}
        LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    ),
    db.query(`SELECT count(*) AS total FROM maintenance_requests r WHERE ${whereSql}`, params),
  ]);
  return { rows: page.rows, total: Number(count.rows[0].total) };
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

/** BR-19: stores the details of photos already saved to disk. */
async function insertAttachments(client, { buildingId, requestId, uploadedBy, updateId = null }, files) {
  for (const f of files) {
    await client.query(
      `INSERT INTO request_attachments (building_id, request_id, update_id, stored_name, original_name, mime_type, size_bytes, uploaded_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [buildingId, requestId, updateId, f.storedName, f.originalName, f.mime, f.size, uploadedBy],
    );
  }
}

/** A request's photos, in upload order. Photos of internal notes only when `includeInternal`. */
async function listAttachments(requestId, { includeInternal }) {
  const { rows } = await db.query(
    `SELECT a.id, a.update_id, a.original_name, a.mime_type, a.size_bytes, a.created_at
       FROM request_attachments a LEFT JOIN request_updates ru ON ru.id = a.update_id
      WHERE a.request_id = $1 AND ($2 OR NOT COALESCE(ru.is_internal, FALSE))
      ORDER BY a.id`,
    [requestId, includeInternal],
  );
  return rows;
}

/** One photo of one request (both ids must match, so photos cannot be fetched through another request). */
async function findAttachment(requestId, attachmentId) {
  const { rows } = await db.query(
    `SELECT a.stored_name, a.original_name, a.mime_type, COALESCE(ru.is_internal, FALSE) AS is_internal
       FROM request_attachments a LEFT JOIN request_updates ru ON ru.id = a.update_id
      WHERE a.request_id = $1 AND a.id = $2`,
    [requestId, attachmentId],
  );
  return rows[0] || null;
}

/** The request row, locked until the transaction ends so two people cannot change it at once. */
async function findForUpdate(client, id) {
  const { rows } = await client.query('SELECT * FROM maintenance_requests WHERE id = $1 FOR UPDATE', [id]);
  return rows[0] || null;
}

// Columns the service may change; anything else is refused.
const UPDATABLE = ['status', 'priority', 'assigned_to', 'reviewed_at', 'rejection_reason', 'resolution_note', 'resolved_at', 'closed_at'];

/** Changes some columns of a request (none is fine) and stamps updated_at. */
async function updateRequest(client, id, fields) {
  const keys = Object.keys(fields);
  if (keys.some((k) => !UPDATABLE.includes(k))) throw new Error(`updateRequest: column not allowed in ${keys}`);
  const sets = [...keys.map((k, i) => `${k} = $${i + 2}`), 'updated_at = now()'];
  await client.query(
    `UPDATE maintenance_requests SET ${sets.join(', ')} WHERE id = $1`,
    [id, ...keys.map((k) => fields[k])],
  );
}

/** FR-19: active staff of a building, for the "assign to" picker. */
async function activeStaff(buildingId) {
  const { rows } = await db.query(
    `SELECT id, full_name FROM users
      WHERE building_id = $1 AND role = 'staff' AND is_active
      ORDER BY full_name`,
    [buildingId],
  );
  return rows.map((r) => ({ id: Number(r.id), fullName: r.full_name }));
}

/**
 * FR-22: choices for the unit and staff filters: every unit, and every staff member,
 * including deactivated ones, so their old requests can still be found.
 */
async function filterOptions(buildingId) {
  const [units, staff] = await Promise.all([
    db.query('SELECT id, unit_number FROM units WHERE building_id = $1 ORDER BY lower(unit_number)', [buildingId]),
    db.query("SELECT id, full_name, is_active FROM users WHERE building_id = $1 AND role = 'staff' ORDER BY full_name", [buildingId]),
  ]);
  return {
    units: units.rows.map((u) => ({ id: Number(u.id), unitNumber: u.unit_number })),
    staff: staff.rows.map((s) => ({ id: Number(s.id), fullName: s.full_name, active: s.is_active })),
  };
}

/** One active staff member of the building, or null (so nobody can assign a resident or an outsider). */
async function findActiveStaff(client, buildingId, id) {
  const { rows } = await client.query(
    `SELECT id, full_name FROM users WHERE id = $1 AND building_id = $2 AND role = 'staff' AND is_active`,
    [id, buildingId],
  );
  return rows[0] || null;
}

/**
 * FR-29: counts for the maintenance overview, all in one pass over the building's requests.
 * "Needs action" means submitted, under review or in progress.
 */
async function overview(buildingId) {
  const { rows } = await db.query(
    `SELECT
       count(*) FILTER (WHERE status = 'submitted')   AS submitted,
       count(*) FILTER (WHERE status = 'under_review') AS under_review,
       count(*) FILTER (WHERE status = 'in_progress')  AS in_progress,
       count(*) FILTER (WHERE status = 'resolved')     AS resolved,
       count(*) FILTER (WHERE status = 'closed')       AS closed,
       count(*) FILTER (WHERE status = ANY($2::request_status[]) AND assigned_to IS NULL) AS unassigned,
       count(*) FILTER (WHERE status = ANY($2::request_status[]) AND priority = 'high') AS high_open,
       count(*) FILTER (WHERE ${OVERDUE_SQL}) AS overdue
     FROM maintenance_requests r
     WHERE building_id = $1`,
    [buildingId, NEEDS_ACTION],
  );
  // count() comes back from PostgreSQL as text; the API sends numbers.
  return Object.fromEntries(Object.entries(rows[0]).map(([k, v]) => [k, Number(v)]));
}

/**
 * BR-18: closes every request resolved more than `days` ago, records it in the
 * history as "System" and notifies the resident (FR-25), in one statement. If two server processes run it at the same
 * time, row locks make the second one skip what the first already closed.
 * Returns the ids that were closed.
 */
async function autoCloseResolved(days, note) {
  const { rows } = await db.query(
    `WITH closed AS (
       UPDATE maintenance_requests
          SET status = 'closed', closed_at = now(), updated_at = now()
        WHERE status = 'resolved' AND resolved_at <= now() - make_interval(days => $1)
        RETURNING id, building_id, submitted_by, request_number
     ), history AS (
       INSERT INTO request_updates (request_id, author_id, kind, from_status, to_status, note)
       SELECT id, NULL, 'status_change', 'resolved', 'closed', $2 FROM closed
     ), told AS (
       -- FR-25: the resident hears about it (same statement, so never one without the other)
       INSERT INTO notifications (building_id, user_id, request_id, message)
       SELECT building_id, submitted_by, id, 'Request ' || request_number || ' was closed automatically.'
         FROM closed WHERE submitted_by IS NOT NULL
     )
     SELECT id AS request_id FROM closed`,
    [days, note],
  );
  return rows.map((r) => Number(r.request_id));
}

/** FR-50: the rating of a request, or null. */
async function findRating(requestId, client = db) {
  const { rows } = await client.query(
    'SELECT rating, comment, created_at FROM request_ratings WHERE request_id = $1',
    [requestId],
  );
  return rows[0] || null;
}

/** FR-50 / BR-26: stores a rating. The primary key refuses a second one for the same request. */
async function insertRating(client, { buildingId, requestId, rating, comment, ratedBy }) {
  await client.query(
    `INSERT INTO request_ratings (building_id, request_id, rating, comment, rated_by)
     VALUES ($1, $2, $3, $4, $5)`,
    [buildingId, requestId, rating, comment, ratedBy],
  );
}

module.exports = {
  overview, autoCloseResolved, findRating, insertRating,
  findForUpdate, updateRequest, activeStaff, findActiveStaff, filterOptions,
  activeUnitsOf, insertRequest, insertUpdate, findById, listRequests, listUpdates,
  insertAttachments, listAttachments, findAttachment,
};
