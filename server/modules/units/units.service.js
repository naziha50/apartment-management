'use strict';
/**
 * Rules for apartments and occupancy. A unit may have several residents and a
 * resident may have several units. Stays are ended, never deleted, so the
 * history is kept. The end date is the last day the person lives there.
 */
const repo = require('./units.repository');
const { Validator, toId } = require('../../lib/validate');
const { badRequest, notFound, conflict } = require('../../lib/errors');
const { dayOf } = require('../../lib/dates');

const TYPES = ['owner', 'tenant'];

/** A whole number from min to max, or null when left empty and not required. */
function wholeNumber(v, field, { label, min, max, required = false }) {
  const raw = String(v.source[field] ?? '').trim();
  if (!raw) {
    if (required) v.fail(field, `${label} is required.`);
    return null;
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < min || n > max) v.fail(field, `${label} must be a whole number from ${min} to ${max}.`);
  return n;
}

async function list(user) {
  return { items: await repo.list(user.buildingId), today: dayOf() };
}

/** One unit with its full history; unknown ids answer 404. */
async function get(user, rawId) {
  const id = toId(rawId);
  const unit = id && (await repo.findById(id, user.buildingId));
  if (!unit) throw notFound('We could not find that apartment.');
  return { ...unit, history: await repo.history(unit.id) };
}

async function create(user, body) {
  const v = new Validator(body);
  const unitNumber = v.text('unitNumber', { max: 10, label: 'Apartment number' })?.toUpperCase();
  if (unitNumber && !/^[A-Z0-9-]+$/.test(unitNumber)) v.fail('unitNumber', 'Use letters, numbers and dashes only, like 4B.');
  const floor = wholeNumber(v, 'floor', { label: 'Floor', min: 0, max: 100, required: true });
  const sizeSqft = wholeNumber(v, 'sizeSqft', { label: 'Size', min: 1, max: 100000 });
  const bedrooms = wholeNumber(v, 'bedrooms', { label: 'Bedrooms', min: 0, max: 20 });
  v.throwIfInvalid();
  try {
    const id = await repo.create(user.buildingId, { unitNumber, floor, sizeSqft, bedrooms });
    return await get(user, id);
  } catch (err) {
    if (err.constraint !== 'units_number_uq') throw err;
    throw badRequest('Please fix the highlighted fields.', { unitNumber: 'This apartment number already exists.' });
  }
}

/** Puts a resident in a unit from a day that is not in the future. */
async function assign(user, rawId, body) {
  const unit = await get(user, rawId);
  if (unit.unavailable) throw conflict('This apartment is marked unavailable.');

  const v = new Validator(body);
  const residentId = v.id('residentId', { label: 'Resident' });
  const type = v.oneOf('type', TYPES, { label: 'Owner or tenant' });
  const startDate = v.date('startDate', { label: 'Move-in date' });
  if (startDate && startDate > dayOf()) v.fail('startDate', 'The move-in date cannot be in the future.');
  if (residentId && !(await repo.activeResidents(user.buildingId)).some((r) => r.id === residentId)) {
    v.fail('residentId', 'Choose an active resident.');
  }
  v.throwIfInvalid();

  try {
    await repo.addStay(user.buildingId, { unitId: unit.id, residentId, type, startDate });
  } catch (err) {
    if (err.code !== '23P01') throw err; // the database forbids overlapping stays (BR-06)
    throw conflict('This resident already has a stay in this apartment that covers these dates.');
  }
  return get(user, unit.id);
}

async function moveOut(user, rawStayId, body) {
  const id = toId(rawStayId);
  const stay = id && (await repo.findStay(id, user.buildingId));
  if (!stay) throw notFound('We could not find that stay.');

  const v = new Validator(body);
  const endDate = v.date('endDate', { label: 'Move-out date' });
  if (endDate && endDate > dayOf()) v.fail('endDate', 'The move-out date cannot be in the future.');
  if (endDate && endDate < stay.startDate) v.fail('endDate', 'The move-out date cannot be before the move-in date.');
  v.throwIfInvalid();

  if (!(await repo.endStay(stay.id, endDate))) throw conflict('This stay has already ended.');
  return get(user, stay.unitId);
}

const activeResidents = (user) => repo.activeResidents(user.buildingId);

module.exports = { list, get, create, assign, moveOut, activeResidents };
