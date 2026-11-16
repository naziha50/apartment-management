'use strict';
/** Database access for notifications (FR-25). SQL only — the rules live in notifications.service.js. */
const db = require('../../db/pool');

/** Stores several notifications in one statement. Takes the caller's transaction `client`. */
async function insertMany(client, rows) {
  if (!rows.length) return;
  await client.query(
    `INSERT INTO notifications (building_id, user_id, request_id, message)
     SELECT * FROM unnest($1::int[], $2::bigint[], $3::bigint[], $4::text[])`,
    [rows.map((r) => r.buildingId), rows.map((r) => r.userId), rows.map((r) => r.requestId), rows.map((r) => r.message)],
  );
}

/** The admin and active staff who may review requests: they hear about new requests. */
async function officeUserIds(client, buildingId) {
  const { rows } = await client.query(
    `SELECT u.id FROM users u
      WHERE u.building_id = $1 AND u.is_active
        AND (u.role = 'admin'
             OR (u.role = 'staff' AND EXISTS (SELECT 1 FROM staff_permissions p WHERE p.user_id = u.id AND p.permission = 'maintenance.review')))`,
    [buildingId],
  );
  return rows.map((r) => Number(r.id));
}

/** One page of a user's notifications, newest first, plus totals for the list and the bell. */
async function listForUser(userId, { limit, offset }) {
  const [page, counts] = await Promise.all([
    db.query(
      `SELECT id, request_id, message, read_at, created_at FROM notifications
        WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    db.query(
      `SELECT count(*) AS total, count(*) FILTER (WHERE read_at IS NULL) AS unread FROM notifications WHERE user_id = $1`,
      [userId],
    ),
  ]);
  return { rows: page.rows, total: Number(counts.rows[0].total), unread: Number(counts.rows[0].unread) };
}

async function unreadCount(userId) {
  const { rows } = await db.query('SELECT count(*) AS n FROM notifications WHERE user_id = $1 AND read_at IS NULL', [userId]);
  return Number(rows[0].n);
}

/** Marks one of the user's own notifications as read. Returns false if it is not theirs. */
async function markRead(userId, id) {
  const { rowCount } = await db.query(
    'UPDATE notifications SET read_at = COALESCE(read_at, now()) WHERE id = $1 AND user_id = $2',
    [id, userId],
  );
  return rowCount > 0;
}

async function markAllRead(userId) {
  await db.query('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [userId]);
}

module.exports = { insertMany, officeUserIds, listForUser, unreadCount, markRead, markAllRead };
