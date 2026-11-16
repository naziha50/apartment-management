'use strict';
/**
 * Scheduled maintenance tasks (FR-49, BR-25): recurring jobs such as monthly lift
 * servicing, so routine upkeep is never forgotten. Managed by the admin and staff with
 * maintenance.assign (SRS Appendix B). createDueRequests() turns due tasks into requests.
 *
 * Dates are Bangladesh calendar days (§2.6) as 'YYYY-MM-DD' text, never Date objects,
 * so they cannot shift by a day between time zones.
 */
const db = require('../../db/pool');
const repo = require('./scheduled-tasks.repository');
const maintenanceRepo = require('./maintenance.repository');
const notifications = require('../notifications/notifications.service');
const { CATEGORIES, SCHEDULE_LEAD_DAYS, MAX_INTERVAL_MONTHS } = require('./maintenance.constants');
const { Validator } = require('../../lib/validate');
const { forbidden, notFound } = require('../../lib/errors');
const { can } = require('../../middleware/current-user');

const DHAKA_DAY = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Dhaka' }); // formats as YYYY-MM-DD
const todayInDhaka = () => DHAKA_DAY.format(new Date());
const addDays = (ymd, days) => new Date(Date.parse(`${ymd}T00:00:00Z`) + days * 86400000).toISOString().slice(0, 10);

function toDto(t) {
  return {
    id: Number(t.id),
    title: t.title,
    description: t.description,
    category: t.category,
    intervalMonths: t.interval_months,
    nextDueDate: t.next_due_date,
    // BR-25: the day the request for the next due date will be created.
    createsRequestOn: addDays(t.next_due_date, -SCHEDULE_LEAD_DAYS),
    paused: t.is_paused,
    defaultAssignee: t.default_assignee
      ? { id: Number(t.default_assignee), fullName: t.default_assignee_name, active: t.default_assignee_active }
      : null,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
  };
}

function requireManager(user) {
  if (!can(user, 'maintenance.assign')) throw forbidden('Only the admin and staff who assign requests can manage scheduled tasks.');
}

const toId = (raw) => {
  const n = Number(raw);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
};

/**
 * Checks the fields of a new task, or (partial) only the fields an edit sends.
 * Returns them as table columns. Every problem is reported at once (UI-04).
 */
async function readFields(user, body = {}, { partial }) {
  const v = new Validator(body);
  const sent = (k) => !partial || body[k] !== undefined;
  const out = {};
  if (sent('title')) out.title = v.text('title', { min: 3, max: 120, label: 'Title' });
  if (sent('description')) out.description = v.text('description', { required: false, max: 4000, label: 'Description' });
  if (sent('category')) out.category = v.oneOf('category', CATEGORIES, { label: 'Category' });
  if (sent('intervalMonths')) {
    const n = v.id('intervalMonths', { label: 'Repeat interval' });
    if (n > MAX_INTERVAL_MONTHS) v.fail('intervalMonths', `Choose a repeat interval from 1 to ${MAX_INTERVAL_MONTHS} months.`);
    out.interval_months = n;
  }
  if (sent('nextDueDate')) {
    const day = v.date('nextDueDate', { label: 'Next due date' });
    if (day && day < todayInDhaka()) v.fail('nextDueDate', 'The next due date cannot be in the past.');
    out.next_due_date = day;
  }
  // Optional on both; empty or null means "nobody by default".
  if (body.defaultAssigneeId !== undefined) {
    const id = v.id('defaultAssigneeId', { required: false, label: 'Default assignee' });
    if (id && !(await maintenanceRepo.findActiveStaff(db, user.buildingId, id))) v.fail('defaultAssigneeId', 'Please choose an active staff member.');
    out.default_assignee = id;
  }
  if (partial && body.paused !== undefined) {
    if (typeof body.paused !== 'boolean') v.fail('paused', 'Paused must be true or false.');
    else out.is_paused = body.paused;
  }
  v.throwIfInvalid();
  return out;
}

/** FR-49: the building's tasks; `?dueWithinDays=90` keeps active tasks due in that many days. */
async function list(user, query = {}) {
  requireManager(user);
  const v = new Validator(query);
  const within = v.id('dueWithinDays', { required: false, label: 'Number of days' });
  if (within > 366) v.fail('dueWithinDays', 'Choose at most 366 days.');
  v.throwIfInvalid('Please choose a valid number of days.');
  const rows = await repo.list(user.buildingId, { dueBy: within ? addDays(todayInDhaka(), within) : null });
  return { items: rows.map(toDto) };
}

async function get(user, rawId) {
  requireManager(user);
  const row = toId(rawId) && (await repo.findById(user.buildingId, toId(rawId)));
  if (!row) throw notFound('We could not find that scheduled task.');
  return toDto(row);
}

/** FR-49: create a task (BR-25: title, category, interval, next due date, optional assignee). */
async function create(user, body) {
  requireManager(user);
  const f = await readFields(user, body, { partial: false });
  const id = await repo.insert({
    buildingId: user.buildingId,
    title: f.title,
    description: f.description,
    category: f.category,
    intervalMonths: f.interval_months,
    nextDueDate: f.next_due_date,
    defaultAssignee: f.default_assignee ?? null,
    createdBy: user.id,
  });
  return get(user, id);
}

/** FR-49: edit a task, or pause / resume it with { paused: true | false }. */
async function update(user, rawId, body) {
  requireManager(user);
  const id = toId(rawId);
  if (!id) throw notFound('We could not find that scheduled task.');
  const fields = await readFields(user, body, { partial: true });
  if (Object.keys(fields).length && !(await repo.update(user.buildingId, id, fields))) {
    throw notFound('We could not find that scheduled task.');
  }
  return get(user, id);
}

const DAY_TEXT = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const dayText = (ymd) => DAY_TEXT.format(new Date(`${ymd}T00:00:00Z`)); // '2026-12-16' → '16 Dec 2026'

/**
 * BR-25: creates the request for one due task, if any is due, in one transaction:
 * the request (common area, Medium, Under review, by "System", assigned to the default
 * assignee if they are still active staff), its history, the move to the next due date
 * and the notification (FR-25, FR-49). Returns null when no task is due, otherwise whether a
 * request was created (false: it already existed, so only the due date moved on).
 */
async function createNextDueRequest() {
  return db.withTransaction(async (client) => {
    const task = await repo.lockNextDue(client, SCHEDULE_LEAD_DAYS);
    if (!task) return null;
    const assignee = task.default_assignee && (await maintenanceRepo.findActiveStaff(client, task.building_id, task.default_assignee));
    const due = dayText(task.next_due_date);
    const request = await maintenanceRepo.insertScheduledRequest(client, {
      buildingId: task.building_id,
      title: task.title,
      description: task.description || `Scheduled maintenance: ${task.title}.`,
      category: task.category,
      assignedTo: assignee ? Number(assignee.id) : null,
      taskId: Number(task.id),
      dueDate: task.next_due_date,
    });
    if (request) {
      await maintenanceRepo.insertUpdate(client, {
        requestId: request.id, authorId: null, kind: 'status_change', toStatus: 'under_review',
        note: `Created from the scheduled task "${task.title}", due ${due}.`,
      });
      if (assignee) {
        await maintenanceRepo.insertUpdate(client, { requestId: request.id, authorId: null, kind: 'assignment', note: `Assigned to ${assignee.full_name}.` });
        await notifications.notify(client, {
          buildingId: task.building_id, requestId: request.id, to: [assignee.id],
          message: `Scheduled job due ${due}: request ${request.requestNumber} (${task.title}) is assigned to you.`,
        });
      } else {
        // Nobody to do it yet: the office has to assign someone.
        await notifications.notifyOffice(client, {
          buildingId: task.building_id, requestId: request.id,
          message: `Scheduled job due ${due}: request ${request.requestNumber} (${task.title}) needs someone assigned.`,
        });
      }
    }
    await repo.advance(client, task.id, SCHEDULE_LEAD_DAYS);
    return Boolean(request);
  });
}

/** BR-25: handles every due task, one transaction each. Returns how many requests were created. */
async function createDueRequests() {
  let created = 0;
  for (let result; (result = await createNextDueRequest()) !== null; ) if (result) created += 1;
  return created;
}

module.exports = { list, get, create, update, createDueRequests, todayInDhaka, addDays };
