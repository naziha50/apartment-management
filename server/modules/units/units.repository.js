'use strict';
/** Database access for apartments (`units`) and who lives in them (`occupancies`). SQL only. */
const db = require('../../db/pool');

// "Current" means the same as in the maintenance module: started, and not ended before today.
const CURRENT = 'o.start_date <= CURRENT_DATE AND (o.end_date IS NULL OR o.end_date >= CURRENT_DATE)';

const toUnit = (row) => ({
  id: Number(row.id),
  unitNumber: row.unit_number,
  floor: row.floor,
  sizeSqft: row.size_sqft,
  bedrooms: row.bedrooms,
  unavailable: row.is_unavailable,
});

const toStay = (row) => ({
  id: Number(row.id),
  residentId: Number(row.resident_id),
  fullName: row.full_name,
  residentActive: row.is_active,
  type: row.occupancy_type,
  startDate: row.start_date,
  endDate: row.end_date,
});

const STAYS = `
  SELECT o.id, o.unit_id, o.resident_id, o.occupancy_type, o.start_date, o.end_date, u.full_name, u.is_active
    FROM occupancies o JOIN users u ON u.id = o.resident_id`;

/** Every unit of the building with its current residents. */
async function list(buildingId) {
  const [units, stays] = await Promise.all([
    db.query('SELECT * FROM units WHERE building_id = $1 ORDER BY floor NULLS LAST, unit_number', [buildingId]),
    db.query(`${STAYS} WHERE o.building_id = $1 AND ${CURRENT} ORDER BY u.full_name, o.id`, [buildingId]),
  ]);
  return units.rows.map((row) => ({
    ...toUnit(row),
    residents: stays.rows.filter((s) => s.unit_id === row.id).map(toStay),
  }));
}

async function findById(id, buildingId) {
  const { rows } = await db.query('SELECT * FROM units WHERE id = $1 AND building_id = $2', [id, buildingId]);
  return rows[0] ? toUnit(rows[0]) : null;
}

/** Everyone who has ever lived in a unit, latest first. */
async function history(unitId) {
  const { rows } = await db.query(`${STAYS} WHERE o.unit_id = $1 ORDER BY o.start_date DESC, o.id DESC`, [unitId]);
  return rows.map(toStay);
}

async function create(buildingId, { unitNumber, floor, sizeSqft, bedrooms }) {
  const { rows } = await db.query(
    `INSERT INTO units (building_id, unit_number, floor, size_sqft, bedrooms) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [buildingId, unitNumber, floor, sizeSqft, bedrooms],
  );
  return Number(rows[0].id);
}

/** Active residents, for the "assign" picker. */
async function activeResidents(buildingId) {
  const { rows } = await db.query(
    `SELECT id, full_name FROM users WHERE building_id = $1 AND role = 'resident' AND is_active ORDER BY full_name, id`,
    [buildingId],
  );
  return rows.map((r) => ({ id: Number(r.id), fullName: r.full_name }));
}

async function addStay(buildingId, { unitId, residentId, type, startDate }) {
  await db.query(
    `INSERT INTO occupancies (building_id, unit_id, resident_id, occupancy_type, start_date) VALUES ($1, $2, $3, $4, $5)`,
    [buildingId, unitId, residentId, type, startDate],
  );
}

async function findStay(id, buildingId) {
  const { rows } = await db.query(`${STAYS} WHERE o.id = $1 AND o.building_id = $2`, [id, buildingId]);
  return rows[0] ? { ...toStay(rows[0]), unitId: Number(rows[0].unit_id) } : null;
}

/** Sets the last day of a stay. Returns false if it already has one. */
async function endStay(id, endDate) {
  const { rowCount } = await db.query('UPDATE occupancies SET end_date = $2 WHERE id = $1 AND end_date IS NULL', [id, endDate]);
  return rowCount > 0;
}

module.exports = { list, findById, history, create, activeResidents, addStay, findStay, endStay };
