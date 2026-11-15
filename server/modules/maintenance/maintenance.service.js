'use strict';
/**
 * Maintenance business rules (SRS §4.3).
 *
 * So far: FR-16 submit a request, FR-17 attach the resident and unit automatically,
 * FR-21 track requests (list + detail with history).
 */
const db = require('../../db/pool');
const repo = require('./maintenance.repository');
const { CATEGORIES, LOCATIONS } = require('./maintenance.constants');
const { Validator } = require('../../lib/validate');
const { forbidden, notFound } = require('../../lib/errors');
const { can } = require('../../middleware/current-user');

/** Turns a database row into the JSON the API returns (camelCase, numbers as numbers). */
function toDto(r) {
  return {
    id: Number(r.id),
    requestNumber: r.request_number,
    title: r.title,
    description: r.description,
    category: r.category,
    location: r.location,
    status: r.status,
    priority: r.priority,
    unit: r.unit_id ? { id: Number(r.unit_id), unitNumber: r.unit_number } : null,
    submittedBy: r.submitted_by ? { id: Number(r.submitted_by), fullName: r.submitted_by_name } : null,
    assignedTo: r.assigned_to ? { id: Number(r.assigned_to), fullName: r.assigned_to_name } : null,
    submittedAt: r.submitted_at,
    updatedAt: r.updated_at,
  };
}

/** FR-17: the units a resident may report for (shown in the form when there is more than one). */
async function myUnits(user) {
  if (user.role !== 'resident') throw forbidden('Only residents have apartments to report for.');
  return repo.activeUnitsOf(user.id);
}

/**
 * FR-16 / FR-17: a resident submits a request.
 * The resident and submission time always come from the server, never from the form,
 * so they cannot be faked or changed afterwards.
 */
async function createRequest(user, body) {
  if (user.role !== 'resident') throw forbidden('Only residents can submit maintenance requests.');

  const v = new Validator(body);
  const title = v.text('title', { min: 3, max: 120, label: 'Title' });
  const description = v.text('description', { min: 1, max: 4000, label: 'Description' });
  const category = v.oneOf('category', CATEGORIES, { label: 'Category' });
  const location = v.oneOf('location', LOCATIONS, { label: 'Location' });

  // FR-17: one active unit → filled in for the resident; several → they must choose one of theirs.
  const units = await repo.activeUnitsOf(user.id);
  let unitId = null;
  if (units.length === 0) {
    v.fail('unitId', 'You have no active apartment. Please contact the building office.');
  } else if (units.length === 1) {
    unitId = units[0].id;
  } else {
    unitId = v.id('unitId', { label: 'Apartment' });
    if (unitId && !units.some((u) => u.id === unitId)) {
      v.fail('unitId', 'Please choose one of your own apartments.');
      unitId = null;
    }
  }
  v.throwIfInvalid();

  // The request and its first history entry are saved together or not at all (NFR-14).
  const id = await db.withTransaction(async (client) => {
    const newId = await repo.insertRequest(client, {
      buildingId: user.buildingId,
      title,
      description,
      category,
      location,
      unitId,
      submittedBy: user.id,
    });
    await repo.insertUpdate(client, { requestId: newId, authorId: user.id, kind: 'status_change', toStatus: 'submitted' });
    return newId;
  });

  return toDto(await repo.findById(id));
}

/* ------------------------------------------------------------- FR-21 track */

/** Who may open a request: its resident, the staff member it is assigned to, and admins / staff with view_all. */
function canView(row, user) {
  if (String(row.building_id) !== String(user.buildingId)) return false;
  if (can(user, 'maintenance.view_all')) return true;
  if (user.role === 'staff') return Number(row.assigned_to) === user.id;
  return Number(row.submitted_by) === user.id;
}

/** Same rule as canView, as a filter for the list. */
function scopeFor(user) {
  if (can(user, 'maintenance.view_all')) return {};
  if (user.role === 'staff') return { assignedTo: user.id };
  return { submittedBy: user.id };
}

/** FR-21: the requests the user may see, most recently updated first. */
async function listRequests(user) {
  const rows = await repo.listRequests(user.buildingId, scopeFor(user));
  return rows.map(toDto);
}

/** FR-21: one request with its history. Requests the user may not see answer 404, never 403 (NFR-24). */
async function getRequest(user, rawId) {
  const id = Number(rawId);
  const row = Number.isSafeInteger(id) && id > 0 ? await repo.findById(id) : null;
  if (!row || !canView(row, user)) throw notFound('We could not find that request.');

  const updates = await repo.listUpdates(id, { includeInternal: user.role !== 'resident' });
  return {
    ...toDto(row),
    updates: updates.map((u) => ({
      id: Number(u.id),
      kind: u.kind,
      fromStatus: u.from_status,
      toStatus: u.to_status,
      note: u.note,
      isInternal: u.is_internal,
      author: u.author_name,
      createdAt: u.created_at,
    })),
  };
}

module.exports = { createRequest, myUnits, listRequests, getRequest, toDto };
