'use strict';
/**
 * Rules for resident accounts. The admin creates and edits them; accounts are
 * deactivated, never deleted, so their history is kept (BR-03).
 */
const repo = require('./residents.repository');
const { Validator, toId } = require('../../lib/validate');
const { badRequest, notFound } = require('../../lib/errors');

const PAGE_SIZE = 25; // UI-07
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** '01712-345678', '8801712345678' and '+8801712345678' all become '+8801712345678' (BR-01), else null. */
function normalizePhone(raw) {
  const digits = String(raw).replace(/[\s-]/g, '').replace(/^(\+?88)?(?=01)/, '');
  return /^01\d{9}$/.test(digits) ? `+88${digits}` : null;
}

/** Checks the form fields and returns the clean values. */
function readFields(source) {
  const v = new Validator(source);
  const fullName = v.text('fullName', { max: 100, label: 'Full name' });
  const email = v.text('email', { max: 150, label: 'Email' })?.toLowerCase() ?? null;
  if (email && !EMAIL.test(email)) v.fail('email', 'Enter a valid email address, like name@example.com.');
  const typed = v.text('phone', { max: 20, label: 'Phone' });
  const phone = typed ? normalizePhone(typed) : null;
  if (typed && !phone) v.fail('phone', 'Enter a Bangladeshi mobile number, like 01712345678.');
  v.throwIfInvalid();
  return { fullName, email, phone };
}

// The database enforces unique email and phone; this turns its error into a message next to the field.
const DUPLICATES = {
  users_email_uq: ['email', 'Another account already uses this email.'],
  users_phone_uq: ['phone', 'Another account already uses this phone number.'],
};

async function saving(fn) {
  try {
    return await fn();
  } catch (err) {
    const duplicate = err.code === '23505' && DUPLICATES[err.constraint];
    if (!duplicate) throw err;
    throw badRequest('Please fix the highlighted fields.', { [duplicate[0]]: duplicate[1] });
  }
}

async function list(user, query = {}) {
  const page = Math.min(10000, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const search = String(query.q ?? '').trim().slice(0, 100);
  const active = { active: true, inactive: false }[query.status] ?? null;
  const result = await repo.list(user.buildingId, { search, active, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  return { ...result, page, pageSize: PAGE_SIZE };
}

/** One resident; unknown ids and non-residents answer 404. */
async function get(user, rawId) {
  const id = toId(rawId);
  const resident = id && (await repo.findById(id, user.buildingId));
  if (!resident) throw notFound('We could not find that resident.');
  return resident;
}

async function create(user, body) {
  const fields = readFields(body);
  const id = await saving(() => repo.create(user.buildingId, fields));
  return get(user, id);
}

/** Fields that are not sent stay as they are. */
async function update(user, rawId, body) {
  const resident = await get(user, rawId);
  const fields = readFields({ ...resident, ...body });
  await saving(() => repo.update(resident.id, fields));
  return get(user, resident.id);
}

async function setActive(user, rawId, active) {
  const resident = await get(user, rawId);
  await repo.setActive(resident.id, active);
  return get(user, resident.id);
}

module.exports = { list, get, create, update, setActive, normalizePhone };
