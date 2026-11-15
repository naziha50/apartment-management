'use strict';
/**
 * Maintenance business rules (SRS §4.3).
 *
 * So far: FR-16 submit a request, FR-17 attach the resident and unit automatically,
 * FR-21 track requests (list + detail with history), BR-19 photos,
 * FR-18 / FR-20 status changes following the rules in state-machine.js (BR-16).
 */
const db = require('../../db/pool');
const repo = require('./maintenance.repository');
const uploads = require('./uploads');
const sm = require('./state-machine');
const { CATEGORIES, LOCATIONS, STATUSES, PRIORITIES } = require('./maintenance.constants');
const { Validator } = require('../../lib/validate');
const { forbidden, notFound, conflict } = require('../../lib/errors');
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
 * so they cannot be faked or changed afterwards. BR-19: up to 3 photos may come with it.
 */
async function createRequest(user, body, files = []) {
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
  const photos = uploads.inspectFiles(files); // all photos checked before anything is saved

  // The request, its first history entry and its photos are saved together or not at all (NFR-14).
  const saved = await uploads.saveFiles(photos);
  let id;
  try {
    id = await db.withTransaction(async (client) => {
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
      await repo.insertAttachments(client, { buildingId: user.buildingId, requestId: newId, uploadedBy: user.id }, saved);
      return newId;
    });
  } catch (err) {
    await uploads.removeFiles(saved); // no orphan files on disk
    throw err;
  }

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

  const [updates, attachments] = await Promise.all([
    repo.listUpdates(id, { includeInternal: user.role !== 'resident' }),
    repo.listAttachments(id),
  ]);
  return {
    ...toDto(row),
    attachments: attachments.map((a) => ({
      id: Number(a.id),
      name: a.original_name,
      mimeType: a.mime_type,
      sizeBytes: a.size_bytes,
      url: `/api/v1/maintenance/requests/${id}/attachments/${a.id}`,
    })),
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
    // The page shows only the moves the server allows (FR-20); they are checked again when posted.
    allowed: { transitions: sm.allowedTransitions(row, user) },
  };
}

/* ------------------------------------------------------ FR-18 / FR-20 status */

const statusText = (s) => s.replace('_', ' ');

/**
 * Every status move in Appendix A goes through here: review (with priority),
 * reject (with reason), start work, resolve (with note), and the resident's
 * cancel, confirm and reopen (FR-35).
 */
async function transition(user, rawId, body) {
  const id = Number(rawId);
  const v = new Validator(body);
  const to = v.oneOf('to', STATUSES, { label: 'Status' });
  v.throwIfInvalid();

  await db.withTransaction(async (client) => {
    const row = Number.isSafeInteger(id) && id > 0 ? await repo.findForUpdate(client, id) : null;
    if (!row || !canView(row, user)) throw notFound('We could not find that request.');
    const move = sm.findTransition(row, user, to);
    if (!move) {
      throw conflict(`This request cannot be moved from "${statusText(row.status)}" to "${statusText(to)}" right now.`, 'TRANSITION_NOT_ALLOWED');
    }

    const priority = move.needs === 'priority' ? v.oneOf('priority', PRIORITIES, { label: 'Priority' }) : null;
    const note = v.text('note', {
      required: move.needs === 'reason' || move.needs === 'note',
      max: 2000,
      label: move.needs === 'reason' ? 'Reason' : 'Note',
    });
    v.throwIfInvalid();

    const now = new Date();
    const fields = { status: to };
    if (to === 'under_review') Object.assign(fields, { priority, reviewed_at: now });
    if (to === 'rejected') fields.rejection_reason = note;
    if (to === 'resolved') Object.assign(fields, { resolution_note: note, resolved_at: now });
    if (to === 'closed') fields.closed_at = now;
    if (move.kind === 'reopen') fields.resolved_at = null;
    await repo.updateRequest(client, id, fields);

    await repo.insertUpdate(client, {
      requestId: id,
      authorId: user.id,
      kind: 'status_change',
      fromStatus: row.status,
      toStatus: to,
      note: note ?? (priority ? `Priority set to ${priority}.` : null),
    });
  });
  return getRequest(user, id);
}

/** BR-19: a photo, only for people who may see its request (NFR-23). */
async function getAttachment(user, rawRequestId, rawAttachmentId) {
  const requestId = Number(rawRequestId);
  const attachmentId = Number(rawAttachmentId);
  const ok = (n) => Number.isSafeInteger(n) && n > 0;
  const row = ok(requestId) ? await repo.findById(requestId) : null;
  if (!row || !canView(row, user) || !ok(attachmentId)) throw notFound('We could not find that photo.');
  const att = await repo.findAttachment(requestId, attachmentId);
  const file = att && uploads.filePath(att.stored_name);
  if (!file) throw notFound('We could not find that photo.');
  return { file, mimeType: att.mime_type, name: att.original_name };
}

module.exports = { createRequest, myUnits, listRequests, getRequest, getAttachment, transition, toDto };
