'use strict';
/** Database access for announcements. SQL only. */
const db = require('../../db/pool');

// The text of the notification a resident gets ($n is the parameter holding the title).
const MESSAGE = (n) => `'New announcement: ' || ${n}`;

const toAnnouncement = (row) => ({
  id: Number(row.id),
  title: row.title,
  body: row.body,
  category: row.category,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** The admin's list, newest first, with how many residents received and read each one. */
async function listAll(buildingId, { limit, offset }) {
  const [page, count] = await Promise.all([
    db.query(
      `SELECT a.*,
              (SELECT count(*) FROM notifications n WHERE n.announcement_id = a.id) AS sent_to,
              (SELECT count(*) FROM notifications n WHERE n.announcement_id = a.id AND n.read_at IS NOT NULL) AS read_by
         FROM announcements a
        WHERE a.building_id = $1
        ORDER BY a.created_at DESC, a.id DESC LIMIT $2 OFFSET $3`,
      [buildingId, limit, offset],
    ),
    db.query('SELECT count(*) AS n FROM announcements WHERE building_id = $1', [buildingId]),
  ]);
  return {
    items: page.rows.map((r) => ({ ...toAnnouncement(r), sentTo: Number(r.sent_to), readBy: Number(r.read_by) })),
    total: Number(count.rows[0].n),
  };
}

/** The announcements one resident received, newest first, with their read state. */
async function listForResident(userId, { limit, offset }) {
  const [page, counts] = await Promise.all([
    db.query(
      `SELECT a.*, n.id AS notification_id, n.read_at
         FROM notifications n JOIN announcements a ON a.id = n.announcement_id
        WHERE n.user_id = $1
        ORDER BY a.created_at DESC, a.id DESC LIMIT $2 OFFSET $3`,
      [userId, limit, offset],
    ),
    db.query(
      `SELECT count(*) AS total, count(*) FILTER (WHERE read_at IS NULL) AS unread
         FROM notifications WHERE user_id = $1 AND announcement_id IS NOT NULL`,
      [userId],
    ),
  ]);
  return {
    items: page.rows.map((r) => ({
      ...toAnnouncement(r),
      notificationId: Number(r.notification_id),
      read: r.read_at != null,
    })),
    total: Number(counts.rows[0].total),
    unread: Number(counts.rows[0].unread),
  };
}

async function findById(id, buildingId) {
  const { rows } = await db.query('SELECT * FROM announcements WHERE id = $1 AND building_id = $2', [id, buildingId]);
  return rows[0] ? toAnnouncement(rows[0]) : null;
}

/** Saves an announcement and notifies every active resident in one statement, so both happen or neither. */
async function publish(buildingId, authorId, { title, body, category }) {
  const { rows } = await db.query(
    `WITH added AS (
       INSERT INTO announcements (building_id, title, body, category, created_by)
       VALUES ($1, $2, $3, $4, $5) RETURNING id
     ), sent AS (
       INSERT INTO notifications (building_id, user_id, announcement_id, message)
       SELECT $1, u.id, added.id, ${MESSAGE('$2::text')}
         FROM users u, added
        WHERE u.building_id = $1 AND u.role = 'resident' AND u.is_active
       RETURNING id
     )
     SELECT id, (SELECT count(*) FROM sent) AS sent_to FROM added`,
    [buildingId, title, body, category, authorId],
  );
  return { id: Number(rows[0].id), sentTo: Number(rows[0].sent_to) };
}

/** Changes an announcement and the title shown in its notifications. Read state is kept. */
async function update(id, { title, body, category }) {
  await db.query(
    `WITH changed AS (
       UPDATE announcements SET title = $2, body = $3, category = $4, updated_at = now() WHERE id = $1 RETURNING id
     )
     UPDATE notifications SET message = ${MESSAGE('$2::text')}
      WHERE announcement_id = (SELECT id FROM changed)`,
    [id, title, body, category],
  );
}

async function remove(id) {
  await db.query('DELETE FROM announcements WHERE id = $1', [id]);
}

/** Marks the user's announcement notifications read; maintenance ones are left alone. */
async function markAllRead(userId) {
  await db.query(
    'UPDATE notifications SET read_at = now() WHERE user_id = $1 AND announcement_id IS NOT NULL AND read_at IS NULL',
    [userId],
  );
}

module.exports = { listAll, listForResident, findById, publish, update, remove, markAllRead };
