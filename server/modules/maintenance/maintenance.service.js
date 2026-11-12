'use strict';
/**
 * Maintenance business rules (SRS §4.3).
 *
 * So far: FR-16 submit a request, FR-17 attach the resident and unit automatically.
 */
const db = require('../../db/pool');
const repo = require('./maintenance.repository');
const { CATEGORIES, LOCATIONS } = require('./maintenance.constants');
const { Validator } = require('../../lib/validate');
const { forbidden } = require('../../lib/errors');

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

module.exports = { createRequest, myUnits, toDto };
