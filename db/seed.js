'use strict';
/**
 * Demo data for development, demos and tests.
 *
 *   npm run db:seed
 *
 * Safe to run more than once: existing rows are kept, missing ones are added.
 * All names, emails and phone numbers are made up. Never run against real data.
 */
const { Client } = require('pg');

const BUILDING = { id: 1, name: 'Green Valley Apartments', address: 'Road 12, Dhanmondi, Dhaka' };

// role, full name, email, phone, staff permissions
const USERS = [
  ['admin', 'Building Admin', 'admin@example.com', '+8801711000001', []],
  ['staff', 'Karim Uddin', 'staff@example.com', '+8801711000002', ['maintenance.view_all', 'maintenance.review']],
  ['staff', 'Jamal Hossain', 'caretaker@example.com', '+8801711000003', []], // default staff: assigned requests only
  ['resident', 'Rahima Rahman', 'resident1@example.com', '+8801711000011', []],
  ['resident', 'Tanvir Ahmed', 'resident2@example.com', '+8801711000012', []],
  ['resident', 'সাদিয়া ইসলাম', 'resident3@example.com', '+8801711000013', []], // Bangla name (NFR-28)
];

// unit number, floor, size (sq ft), bedrooms
const UNITS = [
  ['1A', 1, 1200, 3],
  ['1B', 1, 1100, 2],
  ['2A', 2, 1200, 3],
  ['2B', 2, 1100, 2],
  ['3A', 3, 1450, 3],
  ['3B', 3, 950, 2],
];

// resident email, unit, owner/tenant — Rahima has two units, so she must pick one
// when reporting a problem (FR-17). 1B and 3A stay vacant.
const OCCUPANCIES = [
  ['resident1@example.com', '1A', 'owner'],
  ['resident1@example.com', '3B', 'owner'],
  ['resident2@example.com', '2A', 'tenant'],
  ['resident3@example.com', '2B', 'owner'],
];

async function seed({ databaseUrl, log = console.log } = {}) {
  const client = new Client({ connectionString: databaseUrl || require('../server/config').databaseUrl });
  await client.connect();
  try {
    await client.query('BEGIN');

    await client.query(
      'INSERT INTO buildings (id, name, address) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING',
      [BUILDING.id, BUILDING.name, BUILDING.address],
    );

    const userIds = {};
    for (const [role, fullName, email, phone, permissions] of USERS) {
      const { rows } = await client.query(
        `INSERT INTO users (role, full_name, email, phone) VALUES ($1, $2, $3, $4)
         ON CONFLICT ((lower(email))) WHERE email IS NOT NULL DO UPDATE SET full_name = EXCLUDED.full_name
         RETURNING id`,
        [role, fullName, email, phone],
      );
      userIds[email] = rows[0].id;
      for (const permission of permissions) {
        await client.query(
          'INSERT INTO staff_permissions (user_id, permission) VALUES ($1, $2) ON CONFLICT DO NOTHING',
          [rows[0].id, permission],
        );
      }
    }

    const unitIds = {};
    for (const [unitNumber, floor, size, bedrooms] of UNITS) {
      const { rows } = await client.query(
        `INSERT INTO units (unit_number, floor, size_sqft, bedrooms) VALUES ($1, $2, $3, $4)
         ON CONFLICT (building_id, lower(unit_number)) DO UPDATE SET floor = EXCLUDED.floor
         RETURNING id`,
        [unitNumber, floor, size, bedrooms],
      );
      unitIds[unitNumber] = rows[0].id;
    }

    for (const [email, unitNumber, type] of OCCUPANCIES) {
      await client.query(
        `INSERT INTO occupancies (unit_id, resident_id, occupancy_type, start_date)
         SELECT $1, $2, $3, DATE '2026-01-01'
          WHERE NOT EXISTS (SELECT 1 FROM occupancies WHERE unit_id = $1 AND resident_id = $2)`,
        [unitIds[unitNumber], userIds[email], type],
      );
    }

    await client.query('COMMIT');
    log(`Seeded ${USERS.length} users, ${UNITS.length} units and ${OCCUPANCIES.length} occupancies.`);
    return { userIds, unitIds };
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    await client.end();
  }
}

module.exports = { seed };

if (require.main === module) {
  seed().catch((err) => {
    console.error(`Seeding failed: ${err.message}`);
    console.error('Did you run "npm run db:migrate" first?');
    process.exit(1);
  });
}
