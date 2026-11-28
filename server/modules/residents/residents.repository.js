'use strict';
/** Database access for residents (rows of `users` with role 'resident'). SQL only. */
const db = require('../../db/pool');

// A resident with the units they live in today.
const SELECT = `
  SELECT u.id, u.full_name, u.email, u.phone, u.is_active,
         ARRAY(SELECT un.unit_number
                 FROM occupancies o JOIN units un ON un.id = o.unit_id
                WHERE o.resident_id = u.id AND o.start_date <= CURRENT_DATE
                  AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)
                ORDER BY un.unit_number) AS units
    FROM users u`;

const toResident = (row) => ({
  id: Number(row.id),
  fullName: row.full_name,
  email: row.email,
  phone: row.phone,
  active: row.is_active,
  units: row.units,
});

/** One page of residents by name, optionally searched and filtered by active / inactive. */
async function list(buildingId, { search, active, limit, offset }) {
  const params = [buildingId];
  const where = [`u.building_id = $1`, `u.role = 'resident'`];
  if (active !== null) {
    params.push(active);
    where.push(`u.is_active = $${params.length}`);
  }
  if (search) {
    params.push(`%${search.replace(/[\\%_]/g, '\\$&')}%`); // % and _ are searched as plain characters
    const p = `$${params.length}`;
    where.push(`(u.full_name ILIKE ${p} OR u.email ILIKE ${p} OR u.phone ILIKE ${p}
      OR EXISTS (SELECT 1 FROM occupancies o JOIN units un ON un.id = o.unit_id
                  WHERE o.resident_id = u.id AND o.start_date <= CURRENT_DATE
                    AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)
                    AND un.unit_number ILIKE ${p}))`);
  }
  const filter = `WHERE ${where.join(' AND ')}`;
  const [page, count] = await Promise.all([
    db.query(`${SELECT} ${filter} ORDER BY u.full_name, u.id LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, offset]),
    db.query(`SELECT count(*) AS n FROM users u ${filter}`, params),
  ]);
  return { items: page.rows.map(toResident), total: Number(count.rows[0].n) };
}

/** One resident of this building, or null. */
async function findById(id, buildingId) {
  const { rows } = await db.query(`${SELECT} WHERE u.id = $1 AND u.building_id = $2 AND u.role = 'resident'`, [id, buildingId]);
  return rows[0] ? toResident(rows[0]) : null;
}

async function create(buildingId, { fullName, email, phone }) {
  const { rows } = await db.query(
    `INSERT INTO users (building_id, role, full_name, email, phone) VALUES ($1, 'resident', $2, $3, $4) RETURNING id`,
    [buildingId, fullName, email, phone],
  );
  return Number(rows[0].id);
}

async function update(id, { fullName, email, phone }) {
  await db.query('UPDATE users SET full_name = $2, email = $3, phone = $4, updated_at = now() WHERE id = $1', [id, fullName, email, phone]);
}

async function setActive(id, active) {
  await db.query('UPDATE users SET is_active = $2, updated_at = now() WHERE id = $1', [id, active]);
}

module.exports = { list, findById, create, update, setActive };
