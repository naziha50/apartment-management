'use strict';
/**
 * Database access for scheduled maintenance tasks (FR-49, BR-25). SQL only; the rules
 * live in scheduled-tasks.service.js. Every value is passed as a parameter (NFR-04).
 */
const db = require('../../db/pool');

// next_due_date comes back as 'YYYY-MM-DD' text (DATE columns are read as text, see db/pool.js).
const SELECT = `
  SELECT t.id, t.title, t.description, t.category, t.interval_months, t.is_paused, t.next_due_date,
         t.default_assignee, a.full_name AS default_assignee_name, a.is_active AS default_assignee_active,
         t.created_at, t.updated_at
    FROM scheduled_tasks t
    LEFT JOIN users a ON a.id = t.default_assignee`;

/** The building's tasks: active ones soonest first, then paused ones. `dueBy` keeps only active tasks due on or before that day. */
async function list(buildingId, { dueBy = null } = {}) {
  const { rows } = await db.query(
    `${SELECT}
      WHERE t.building_id = $1 AND ($2::date IS NULL OR (NOT t.is_paused AND t.next_due_date <= $2::date))
      ORDER BY t.is_paused, t.next_due_date, t.id`,
    [buildingId, dueBy],
  );
  return rows;
}

async function findById(buildingId, id) {
  const { rows } = await db.query(`${SELECT} WHERE t.building_id = $1 AND t.id = $2`, [buildingId, id]);
  return rows[0] || null;
}

async function insert(t) {
  const { rows } = await db.query(
    `INSERT INTO scheduled_tasks (building_id, title, description, category, interval_months, next_due_date, default_assignee, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
    [t.buildingId, t.title, t.description, t.category, t.intervalMonths, t.nextDueDate, t.defaultAssignee, t.createdBy],
  );
  return Number(rows[0].id);
}

// Columns an edit may change; anything else is refused.
const UPDATABLE = ['title', 'description', 'category', 'interval_months', 'next_due_date', 'default_assignee', 'is_paused'];

/** Changes some columns of one task of the building; returns false when there is no such task. */
async function update(buildingId, id, fields) {
  const keys = Object.keys(fields);
  if (keys.some((k) => !UPDATABLE.includes(k))) throw new Error(`scheduled task update: column not allowed in ${keys}`);
  const sets = [...keys.map((k, i) => `${k} = $${i + 3}`), 'updated_at = now()'];
  const { rowCount } = await db.query(
    `UPDATE scheduled_tasks SET ${sets.join(', ')} WHERE building_id = $1 AND id = $2`,
    [buildingId, id, ...keys.map((k) => fields[k])],
  );
  return rowCount === 1;
}

/**
 * BR-25: the soonest active task whose request is due to be created (its due date is at most
 * `leadDays` away), locked for this transaction. SKIP LOCKED makes another
 * server process running the same job pass over it instead of waiting and doing it twice.
 */
async function lockNextDue(client, leadDays) {
  const { rows } = await client.query(
    `SELECT id, building_id, title, description, category, interval_months, default_assignee, next_due_date
       FROM scheduled_tasks
      WHERE NOT is_paused AND next_due_date - $1::int <= CURRENT_DATE
      ORDER BY next_due_date, id
      LIMIT 1
      FOR UPDATE SKIP LOCKED`,
    [leadDays],
  );
  return rows[0] || null;
}

/**
 * BR-25: moves the next due date forward by the interval until its request is no longer due,
 * so a task missed while the server was off creates one request, not one per missed period.
 * Returns the new date.
 */
async function advance(client, id, leadDays) {
  const { rows } = await client.query(
    `UPDATE scheduled_tasks t
        SET next_due_date = (
              SELECT min(d)::date FROM generate_series(
                t.next_due_date + make_interval(months => t.interval_months),
                -- far enough for any outage (at most 1,200 monthly steps to look through)
                t.next_due_date + make_interval(years => 100),
                make_interval(months => t.interval_months)) AS d
               WHERE d::date - $2::int > CURRENT_DATE),
            updated_at = now()
      WHERE t.id = $1
      RETURNING next_due_date`,
    [id, leadDays],
  );
  return rows[0].next_due_date;
}

module.exports = { list, findById, insert, update, lockNextDue, advance };
