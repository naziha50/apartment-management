'use strict';
/**
 * Administrative dashboard API (admin only).
 *
 * GET /api/v1/dashboard           FR-27 occupancy, FR-28 billing, FR-29 maintenance, FR-30 recent activity
 * GET /api/v1/dashboard/search    FR-30 search residents, units, bills and requests (?q=text)
 */
const express = require('express');
const dashboard = require('./dashboard.repository');
const { requireUser } = require('../../middleware/current-user');
const { badRequest, forbidden } = require('../../lib/errors');

const router = express.Router();

const TYPE_TEXT = { service_charge: 'Service charge', rent: 'Rent', utility: 'Utility', other: 'Other' };
const METHOD_TEXT = { cash: 'cash', bkash: 'bKash', bank: 'bank' };

/** Stops the request unless the current user is the admin. */
function requireAdmin(req, res, next) {
  return req.user.role === 'admin' ? next() : next(forbidden('Only the admin can see the dashboard.'));
}

/** Escapes % _ and \ so the user's text is matched literally by ILIKE. */
function toPattern(text) {
  return '%' + text.replace(/[\\%_]/g, '\\$&') + '%';
}

/** The status of a bill, using the shared billing definitions. */
function billStatus(bill) {
  if (bill.total > 0 && bill.paid >= bill.total) return 'paid';
  return bill.past_due ? 'overdue' : 'unpaid';
}

router.get('/dashboard', requireUser, requireAdmin, async (req, res) => {
  const buildingId = req.user.buildingId;

  // FR-27
  const counts = await dashboard.getOccupancyCounts(buildingId);
  const occupancy = {
    totalUnits: counts.total_units,
    occupiedUnits: counts.occupied_units,
    vacantUnits: counts.total_units - counts.occupied_units,
    residents: counts.residents,
  };

  // FR-28
  const money = await dashboard.getBillingTotals(buildingId);
  const billing = { collected: money.collected, outstanding: money.outstanding, overdueBills: money.overdue_bills };

  // FR-29: null until the maintenance module's table exists
  const hasMaintenance = await dashboard.tableExists('maintenance_requests');
  let maintenance = null;
  if (hasMaintenance) {
    const result = await dashboard.getMaintenanceCounts(buildingId);
    maintenance = { byStatus: {}, overdue: result.overdue };
    for (const row of result.rows) maintenance.byStatus[row.status] = row.count;
  }

  // FR-30: collect items from each source, then sort and keep the newest 10
  const items = [];
  for (const b of await dashboard.recentBills(buildingId)) {
    items.push({ kind: 'bill', at: b.at, text: `Bill created for ${b.unit_number} – ${TYPE_TEXT[b.bill_type]} ${b.month_label}` });
  }
  for (const p of await dashboard.recentPayments(buildingId)) {
    items.push({ kind: 'payment', at: p.at, text: `৳${p.amount.toLocaleString('en-IN')} received from ${p.unit_number} by ${METHOD_TEXT[p.method]}` });
  }
  if (hasMaintenance) {
    for (const r of await dashboard.recentRequests(buildingId)) {
      items.push({ kind: 'request', at: r.at, text: `Request ${r.request_number} submitted – ${r.title}` });
    }
  }
  items.sort((a, b) => new Date(b.at) - new Date(a.at));

  res.json({
    occupancy,
    billing,
    maintenance,
    recentActivity: items.slice(0, 10),
    announcementsAvailable: await dashboard.tableExists('announcements'),
  });
});

router.get('/dashboard/search', requireUser, requireAdmin, async (req, res) => {
  const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
  if (q.length < 2) throw badRequest('Type at least 2 characters to search.');
  const buildingId = req.user.buildingId;
  const pattern = toPattern(q);

  const residents = await dashboard.searchResidents(buildingId, pattern);
  const units = await dashboard.searchUnits(buildingId, pattern);
  const billRows = await dashboard.searchBills(buildingId, pattern);
  let requests = [];
  if (await dashboard.tableExists('maintenance_requests')) {
    requests = await dashboard.searchRequests(buildingId, pattern);
  }

  res.json({
    residents: residents.map((r) => ({
      id: r.id, fullName: r.full_name, email: r.email, phone: r.phone,
      units: r.units ? r.units.split(', ') : [],
    })),
    units: units.map((u) => ({ id: u.id, unitNumber: u.unit_number, floor: u.floor, occupied: u.occupied })),
    bills: billRows.map((b) => ({
      id: b.id, unitNumber: b.unit_number, billType: TYPE_TEXT[b.bill_type], month: b.month_label,
      total: b.total, status: billStatus(b),
    })),
    requests: requests.map((r) => ({ id: r.id, requestNumber: r.request_number, title: r.title, status: r.status })),
  });
});

module.exports = router;
