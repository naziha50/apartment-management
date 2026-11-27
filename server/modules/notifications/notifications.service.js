'use strict';
/**
 * In-app notifications (FR-25).
 *
 * Other modules call notify() inside their own transaction, so the change and
 * its notifications are saved together or not at all. Nobody is notified about
 * their own action.
 */
const repo = require('./notifications.repository');
const { notFound } = require('../../lib/errors');

const PAGE_SIZE = 25; // UI-07
const MAX_MESSAGE = 300; // matches the CHECK in migration 007

/**
 * Sends `message` to every user in `to` except `except` (the person acting).
 * Empty and repeated ids are ignored. `client` is the caller's transaction.
 */
async function notify(client, { buildingId, requestId = null, message, to, except }) {
  const userIds = [...new Set(to.filter((id) => id != null).map(Number))].filter((id) => id !== Number(except));
  const text = message.length > MAX_MESSAGE ? `${message.slice(0, MAX_MESSAGE - 1)}…` : message;
  await repo.insertMany(client, userIds.map((userId) => ({ buildingId, userId, requestId, message: text })));
}

/** Tells the office: the admin and staff who see every request (FR-16: a new request). */
async function notifyOffice(client, { buildingId, requestId, message, except }) {
  await notify(client, { buildingId, requestId, message, to: await repo.officeUserIds(client, buildingId), except });
}

/** The user's notifications, newest first, 25 per page, with the unread count. */
async function list(user, query = {}) {
  const page = Math.min(10000, Math.max(1, Number.parseInt(query.page, 10) || 1));
  const { rows, total, unread } = await repo.listForUser(user.id, { limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE });
  return {
    items: rows.map((n) => ({
      id: Number(n.id),
      requestId: n.request_id ? Number(n.request_id) : null,
      message: n.message,
      read: n.read_at != null,
      createdAt: n.created_at,
    })),
    page,
    pageSize: PAGE_SIZE,
    total,
    unread,
  };
}

const unreadCount = (user) => repo.unreadCount(user.id);

/** Marks one notification read; other people's notifications answer 404. */
async function markRead(user, rawId) {
  const id = Number(rawId);
  if (!Number.isSafeInteger(id) || id <= 0 || !(await repo.markRead(user.id, id))) throw notFound('We could not find that notification.');
}

const markAllRead = (user) => repo.markAllRead(user.id);

module.exports = { notify, notifyOffice, list, unreadCount, markRead, markAllRead };
