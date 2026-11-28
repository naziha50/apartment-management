'use strict';
/**
 * Rules for announcements. The admin publishes, edits and deletes them; every
 * resident who is active at the time of publishing receives one.
 */
const repo = require('./announcements.repository');
const { Validator, toId } = require('../../lib/validate');
const { notFound } = require('../../lib/errors');

const PAGE_SIZE = 25; // UI-07
const CATEGORIES = ['service', 'maintenance', 'meeting', 'rules'];

function readFields(source) {
  const v = new Validator(source);
  const title = v.text('title', { max: 150, label: 'Title' });
  const body = v.text('body', { max: 5000, label: 'Message' });
  const category = v.oneOf('category', CATEGORIES, { label: 'Category' });
  v.throwIfInvalid();
  return { title, body, category };
}

/** The admin sees every announcement with read counts; a resident sees their own. */
async function list(user, query = {}) {
  const page = Math.min(10000, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const range = { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
  const result =
    user.role === 'admin' ? await repo.listAll(user.buildingId, range) : await repo.listForResident(user.id, range);
  return { ...result, page, pageSize: PAGE_SIZE };
}

async function get(user, rawId) {
  const id = toId(rawId);
  const announcement = id && (await repo.findById(id, user.buildingId));
  if (!announcement) throw notFound('We could not find that announcement.');
  return announcement;
}

async function publish(user, body) {
  const { id, sentTo } = await repo.publish(user.buildingId, user.id, readFields(body));
  return { announcement: await get(user, id), sentTo };
}

/** Fields that are not sent stay as they are. */
async function update(user, rawId, body) {
  const announcement = await get(user, rawId);
  await repo.update(announcement.id, readFields({ ...announcement, ...body }));
  return get(user, announcement.id);
}

async function remove(user, rawId) {
  const announcement = await get(user, rawId);
  await repo.remove(announcement.id);
}

const markAllRead = (user) => repo.markAllRead(user.id);

module.exports = { list, publish, update, remove, markAllRead };
