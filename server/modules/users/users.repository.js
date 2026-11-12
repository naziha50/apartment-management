'use strict';
/** Database access for users. SQL only — no business rules here. */
const db = require('../../db/pool');

const USER_COLUMNS = `
  u.id, u.building_id, u.role, u.full_name, u.email, u.phone,
  COALESCE(array_agg(p.permission ORDER BY p.permission) FILTER (WHERE p.permission IS NOT NULL), '{}') AS permissions`;

function toUser(row) {
  return {
    id: Number(row.id),
    buildingId: row.building_id,
    role: row.role,
    fullName: row.full_name,
    email: row.email,
    phone: row.phone,
    // Admins can do everything; staff only what they were granted (Appendix B).
    permissions: row.role === 'staff' ? row.permissions : [],
  };
}

/** One active user with their permissions, or null. */
async function findActiveById(id) {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}
       FROM users u LEFT JOIN staff_permissions p ON p.user_id = u.id
      WHERE u.id = $1 AND u.is_active
      GROUP BY u.id`,
    [id],
  );
  return rows[0] ? toUser(rows[0]) : null;
}

/** All active users, for the "Viewing as" list: admins, then staff, then residents. */
async function listActive() {
  const { rows } = await db.query(
    `SELECT ${USER_COLUMNS}
       FROM users u LEFT JOIN staff_permissions p ON p.user_id = u.id
      WHERE u.is_active
      GROUP BY u.id
      ORDER BY array_position(ARRAY['admin','staff','resident']::user_role[], u.role), u.full_name`,
  );
  return rows.map(toUser);
}

module.exports = { findActiveById, listActive };
