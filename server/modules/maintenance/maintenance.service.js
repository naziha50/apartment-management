'use strict';
/**
 * Maintenance business rules (SRS §4.3).
 *
 * So far: FR-16 submit a request, FR-17 attach the resident and unit automatically,
 * FR-21 track requests (list + detail with history), BR-19 photos,
 * FR-18 / FR-20 status changes following the rules in state-machine.js (BR-16),
 * FR-19 assigning requests to staff, FR-20 progress notes (internal ones hidden from residents),
 * FR-25 notifications for every change, written in the same transaction as the change.
 */
const db = require('../../db/pool');
const repo = require('./maintenance.repository');
const uploads = require('./uploads');
const sm = require('./state-machine');
const notifications = require('../notifications/notifications.service');
const { CATEGORIES, LOCATIONS, STATUSES, PRIORITIES, RESOLVED_DAYS } = require('./maintenance.constants');
const { Validator } = require('../../lib/validate');
const { toCsv } = require('../../lib/csv');
const { forbidden, notFound, conflict, badRequest } = require('../../lib/errors');
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
    resolvedAt: r.resolved_at,
    // BR-18: when a resolved request will close by itself if the resident does nothing.
    autoCloseAt: r.status === 'resolved' && r.resolved_at
      ? new Date(new Date(r.resolved_at).getTime() + RESOLVED_DAYS * 24 * 60 * 60 * 1000).toISOString()
      : null,
    // BR-17: the target time and whether it has passed (only while the request still needs action).
    dueAt: sm.deadline(r).toISOString(),
    overdue: sm.isOverdue(r),
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
      await notifications.notifyOffice(client, {
        buildingId: user.buildingId, requestId: newId, except: user.id,
        message: `New request from ${user.fullName}: ${title}`,
      });
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

/** A positive whole-number id from the URL, or null. */
function toId(raw) {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/**
 * The request row, but only if this user may see it; otherwise 404, never 403,
 * so ids cannot be probed (NFR-24). Every read and change goes through here.
 * With a transaction `client` the row is also locked until the change is saved.
 */
async function loadVisible(rawId, user, client) {
  const id = toId(rawId);
  const row = id && (client ? await repo.findForUpdate(client, id) : await repo.findById(id));
  if (!row || !canView(row, user)) throw notFound('We could not find that request.');
  return row;
}

/** Same rule as canView, as a filter for the list. */
function scopeFor(user) {
  if (can(user, 'maintenance.view_all')) return {};
  if (user.role === 'staff') return { assignedTo: user.id };
  return { submittedBy: user.id };
}

const PAGE_SIZE = 20;
const MAX_PAGE = 10000; // keeps OFFSET a sane number whatever is typed into the address bar

/** FR-22: list filters from the query string, e.g. ?status=submitted,under_review&priority=high&q=tap */
function parseFilters(query = {}) {
  const v = new Validator(query);
  const statuses = String(query.status || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (statuses.some((s) => !STATUSES.includes(s))) v.fail('status', 'Please choose a valid status.');
  const filters = {
    statuses,
    category: v.oneOf('category', CATEGORIES, { required: false, label: 'Category' }),
    priority: v.oneOf('priority', [...PRIORITIES, 'unset'], { required: false, label: 'Priority' }),
    unassigned: v.oneOf('assigned', ['none'], { required: false, label: 'Assigned-to filter' }) === 'none', // ?assigned=none (FR-29 tile)
    overdue: v.oneOf('overdue', ['1'], { required: false, label: 'Overdue filter' }) === '1', // ?overdue=1 (BR-17)
    sort: v.oneOf('sort', ['oldest'], { required: false, label: 'Sort order' }), // ?sort=oldest (FR-18 review queue)
    q: typeof query.q === 'string' ? query.q.trim().slice(0, 100) || null : null,
    unitId: v.id('unitId', { required: false, label: 'Apartment' }),
    assignedTo: v.id('assignedTo', { required: false, label: 'Staff member' }),
    from: v.date('from', { required: false, label: 'Start date' }),
    to: v.date('to', { required: false, label: 'End date' }),
  };
  // Dates in the same YYYY-MM-DD form compare correctly as text.
  if (filters.from && filters.to && filters.from > filters.to) v.fail('to', 'The end date must be on or after the start date.');
  v.throwIfInvalid('Some filters are not valid.');
  return filters;
}

/** FR-21 / FR-22: one page of the requests the user may see, most recently updated first. */
async function listRequests(user, query = {}) {
  const page = Math.min(MAX_PAGE, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const { rows, total } = await repo.listRequests(user.buildingId, scopeFor(user), parseFilters(query), {
    limit: PAGE_SIZE,
    offset: (page - 1) * PAGE_SIZE,
  });
  return { items: rows.map(toDto), page, pageSize: PAGE_SIZE, total };
}

// FR-38: the export holds every match, not one page.
// shortcut: built in memory, capped at EXPORT_MAX rows (years of requests for one building); stream it in batches if a building ever needs more.
const EXPORT_MAX = 10000;

// Dates in the export: Bangladesh time (§2.6), in a form spreadsheets sort correctly ("2026-11-16 14:05").
const CSV_TIME = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
const csvTime = (d) => (d ? CSV_TIME.format(new Date(d)) : '');
// "water_supply" → "Water supply"; every category, status, priority and location reads well this way.
const words = (v) => (v ? v[0].toUpperCase() + v.slice(1).replaceAll('_', ' ') : '');

const EXPORT_COLUMNS = [
  ['Request number', (r) => r.requestNumber],
  ['Title', (r) => r.title],
  ['Description', (r) => r.description],
  ['Category', (r) => words(r.category)],
  ['Location', (r) => (r.location === 'unit' ? 'Inside the apartment' : 'Common area')], // same words as the app
  ['Apartment', (r) => r.unit?.unitNumber],
  ['Status', (r) => words(r.status)],
  ['Priority', (r) => words(r.priority) || 'Not set'],
  ['Overdue', (r) => (r.overdue ? 'Yes' : 'No')],
  ['Submitted by', (r) => r.submittedBy?.fullName],
  ['Assigned to', (r) => r.assignedTo?.fullName],
  ['Submitted', (r) => csvTime(r.submittedAt)],
  ['Due by', (r) => csvTime(r.dueAt)],
  ['Resolved', (r) => csvTime(r.resolvedAt)],
  ['Last updated', (r) => csvTime(r.updatedAt)],
];

/**
 * FR-38: the request list as CSV, with the same filters and the same "who sees what" as the
 * list page. For the admin and staff only; residents follow their requests in the app.
 * Internal notes are never part of it.
 */
async function exportRequests(user, query = {}) {
  if (user.role === 'resident') throw forbidden('Only the admin and staff can export the request list.');
  const { rows, total } = await repo.listRequests(user.buildingId, scopeFor(user), parseFilters(query), { limit: EXPORT_MAX, offset: 0 });
  if (total > EXPORT_MAX) {
    throw badRequest(`${total} requests match, but one export holds at most ${EXPORT_MAX}. Narrow the filters, for example with a date range.`);
  }
  const items = rows.map(toDto);
  const today = CSV_TIME.format(new Date()).slice(0, 10);
  return {
    filename: `maintenance-requests-${today}.csv`,
    body: toCsv(EXPORT_COLUMNS.map(([h]) => h), items.map((r) => EXPORT_COLUMNS.map(([, get]) => get(r)))),
  };
}

/** FR-21: one request with its history. Requests the user may not see answer 404, never 403 (NFR-24). */
async function getRequest(user, rawId) {
  const id = Number(rawId);
  const row = await loadVisible(id, user);

  const [updates, attachments, rating] = await Promise.all([
    repo.listUpdates(id, { includeInternal: user.role !== 'resident' }),
    repo.listAttachments(id, { includeInternal: user.role !== 'resident' }),
    repo.findRating(id),
  ]);
  return {
    ...toDto(row),
    attachments: attachments.map((a) => ({
      id: Number(a.id),
      updateId: a.update_id ? Number(a.update_id) : null, // the note it came with; null = reported with the request
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
    allowed: {
      transitions: sm.allowedTransitions(row, user),
      assign: sm.canAssign(row, user),
      addNote: sm.canAddNote(row, user),
      setPriority: sm.canSetPriority(row, user),
      rate: sm.canRate(row, user, { alreadyRated: Boolean(rating) }),
    },
    // FR-50: the resident's rating, shown to everyone who can see the request.
    rating: rating ? { rating: rating.rating, comment: rating.comment, createdAt: rating.created_at } : null,
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
    const row = await loadVisible(id, user, client);
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
    const what = move.kind === 'reopen' ? 'was reopened' : `is now ${statusText(to)}`;
    await notifications.notify(client, {
      buildingId: row.building_id, requestId: id, except: user.id,
      to: [row.submitted_by, row.assigned_to],
      message: `Request ${row.request_number} ${what}${to === 'rejected' ? `. Reason: ${note}` : ''}.`,
    });
  });
  return getRequest(user, id);
}

/** BR-19: a photo, only for people who may see its request (NFR-23). */
async function getAttachment(user, rawRequestId, rawAttachmentId) {
  const row = await loadVisible(rawRequestId, user);
  const attachmentId = toId(rawAttachmentId);
  const att = attachmentId && (await repo.findAttachment(row.id, attachmentId));
  // A photo on an internal note is as private as the note (FR-20).
  if (att?.is_internal && user.role === 'resident') throw notFound('We could not find that photo.');
  const file = att && uploads.filePath(att.stored_name);
  if (!file) throw notFound('We could not find that photo.');
  return { file, mimeType: att.mime_type, name: att.original_name };
}

/* ---------------------------------------------------------- FR-50 rating */

/** FR-50 / BR-26: the resident rates a closed request once, 1 to 5 stars, with an optional comment. */
async function rate(user, rawId, body) {
  const id = Number(rawId);
  const v = new Validator(body);
  const rating = Number(body?.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) v.fail('rating', 'Please choose from 1 to 5 stars.');
  const comment = v.text('comment', { required: false, max: 500, label: 'Comment' });
  v.throwIfInvalid();

  await db.withTransaction(async (client) => {
    const row = await loadVisible(id, user, client); // locked: two quick clicks cannot both pass the check
    const problem = sm.ratingProblem(row, user, { alreadyRated: Boolean(await repo.findRating(id, client)) });
    if (problem) {
      if (user.role !== 'resident' || Number(row.submitted_by) !== user.id) throw forbidden(problem);
      throw conflict(problem, 'RATING_NOT_ALLOWED');
    }
    await repo.insertRating(client, { buildingId: user.buildingId, requestId: id, rating, comment, ratedBy: user.id });
  });
  return getRequest(user, id);
}

/* ------------------------------------------------------- BR-18 auto-close */

/** BR-18: closes resolved requests the resident has not reopened within RESOLVED_DAYS. Returns how many. */
async function autoCloseResolved() {
  const ids = await repo.autoCloseResolved(
    RESOLVED_DAYS,
    `Closed automatically: nobody reopened it within ${RESOLVED_DAYS} days of being resolved.`,
  );
  return ids.length;
}

/* --------------------------------------------------------- FR-29 overview */

/** FR-29: request counts for the building. They cover every request, so only users who may see all of them get it. */
async function overview(user) {
  if (!can(user, 'maintenance.view_all')) throw forbidden('Only the admin and staff who see all requests can view the overview.');
  return repo.overview(user.buildingId);
}

/* ------------------------------------------------------------ FR-19 assign */

/** Staff the user may assign requests to. */
/** FR-22 / FR-50: the maintenance report for requests submitted between two Bangladesh days (both optional). */
async function report(user, query = {}) {
  if (!can(user, 'reports.view')) throw forbidden('Only the admin and staff with the reports permission can view the maintenance report.');
  const v = new Validator(query);
  const from = v.date('from', { required: false, label: 'Start date' });
  const to = v.date('to', { required: false, label: 'End date' });
  if (from && to && from > to) v.fail('to', 'The end date must be on or after the start date.');
  v.throwIfInvalid('Please choose a valid period.');
  return { from, to, ...(await repo.report(user.buildingId, { from, to })) };
}

/** FR-22: units and staff for the list filters, for those who see every request. */
async function filterOptions(user) {
  if (!can(user, 'maintenance.view_all')) throw forbidden('Only the admin and staff who see all requests can use these filters.');
  return repo.filterOptions(user.buildingId);
}

async function staffList(user) {
  if (!can(user, 'maintenance.assign')) throw forbidden('You cannot assign requests.');
  return repo.activeStaff(user.buildingId);
}

/**
 * FR-19: assign or reassign a request to an active staff member of the building.
 * Every change is kept in the history, so it shows who was responsible when.
 * shortcut: staff with maintenance.assign but not view_all lose sight of a request they
 * reassign away and get a 404 after saving; revisit when staff permissions get a screen.
 */
async function assign(user, rawId, body) {
  const id = Number(rawId);
  const v = new Validator(body);
  const staffId = v.id('staffId', { label: 'Staff member' });
  v.throwIfInvalid();

  await db.withTransaction(async (client) => {
    const row = await loadVisible(id, user, client);
    if (!can(user, 'maintenance.assign')) throw forbidden('You cannot assign requests.');
    if (!sm.canAssign(row, user)) {
      throw conflict(`A request that is ${statusText(row.status)} can no longer be assigned.`, 'NOT_ASSIGNABLE');
    }

    const staff = await repo.findActiveStaff(client, user.buildingId, staffId);
    if (!staff) {
      v.fail('staffId', 'Please choose an active staff member.');
      v.throwIfInvalid();
    }
    if (Number(row.assigned_to) === staffId) return; // already theirs: nothing to record

    await repo.updateRequest(client, id, { assigned_to: staffId });
    await repo.insertUpdate(client, {
      requestId: id,
      authorId: user.id,
      kind: 'assignment',
      note: `${row.assigned_to ? 'Reassigned' : 'Assigned'} to ${staff.full_name}.`,
    });
    await notifications.notify(client, {
      buildingId: row.building_id, requestId: id, except: user.id, to: [staffId],
      message: `You were assigned request ${row.request_number}: ${row.title}`,
    });
  });
  return getRequest(user, id);
}

/* ------------------------------------------------------------- FR-20 notes */

/**
 * FR-20: a progress note. `internal: true` keeps it to staff and the admin;
 * residents never receive internal notes (see listUpdates).
 */
async function addNote(user, rawId, body, files = []) {
  const id = Number(rawId);
  const v = new Validator(body);
  const note = v.text('note', { max: 2000, label: 'Note' });
  const internal = body?.internal === true || body?.internal === 'true';
  v.throwIfInvalid();

  const photos = uploads.inspectFiles(files); // BR-19: checked before anything is saved
  let saved = [];
  try {
    await db.withTransaction(async (client) => {
      const row = await loadVisible(id, user, client);
      if (!sm.canAddNote(row, user)) throw forbidden('You cannot add notes to this request.');
      const updateId = await repo.insertUpdate(client, { requestId: id, authorId: user.id, kind: 'note', note, isInternal: internal });
      // Files are written only once the person is allowed to add this note.
      saved = await uploads.saveFiles(photos);
      await repo.insertAttachments(client, { buildingId: row.building_id, requestId: id, uploadedBy: user.id, updateId }, saved);
      await notifications.notify(client, {
        buildingId: row.building_id, requestId: id, except: user.id,
        to: internal ? [row.assigned_to] : [row.submitted_by, row.assigned_to], // residents never hear about internal notes
        message: `${internal ? 'Internal note' : 'New note'} on request ${row.request_number}: ${note}`,
      });
      await repo.updateRequest(client, id, {}); // a note is activity: move it up in the lists
    });
  } catch (err) {
    await uploads.removeFiles(saved); // no orphan files on disk
    throw err;
  }
  return getRequest(user, id);
}

/* ---------------------------------------------------------- FR-18 priority */

const priorityText = (p) => (p ? p[0].toUpperCase() + p.slice(1) : 'not set');

/** FR-18: change the priority after review. The change is kept in the history. */
async function setPriority(user, rawId, body) {
  const id = Number(rawId);
  const v = new Validator(body);
  const priority = v.oneOf('priority', PRIORITIES, { label: 'Priority' });
  v.throwIfInvalid();

  await db.withTransaction(async (client) => {
    const row = await loadVisible(id, user, client);
    if (!can(user, 'maintenance.review')) throw forbidden('You cannot change the priority of requests.');
    if (!sm.canSetPriority(row, user)) {
      throw conflict(`You cannot change the priority of a request that is ${statusText(row.status)}.`, 'PRIORITY_LOCKED');
    }
    if (row.priority === priority) return; // unchanged: nothing to record

    await repo.updateRequest(client, id, { priority });
    await repo.insertUpdate(client, {
      requestId: id,
      authorId: user.id,
      kind: 'priority',
      note: `Priority changed from ${priorityText(row.priority)} to ${priorityText(priority)}.`,
    });
    await notifications.notify(client, {
      buildingId: row.building_id, requestId: id, except: user.id, to: [row.assigned_to],
      message: `Priority of request ${row.request_number} changed to ${priorityText(priority)}.`,
    });
  });
  return getRequest(user, id);
}

module.exports = {
  createRequest, myUnits, listRequests, exportRequests, getRequest, getAttachment,
  transition, staffList, filterOptions, report, assign, addNote, setPriority, overview, autoCloseResolved, rate,
};
