'use strict';
/**
 * Notification endpoints (mounted at /api/v1/notifications), always for the current user only.
 *
 *   GET  /               my notifications, newest first (?page=)   FR-25
 *   GET  /unread-count   number for the bell in the top bar
 *   POST /:id/read       mark one as read
 *   POST /read-all       mark all as read
 */
const express = require('express');
const service = require('./notifications.service');
const { requireUser } = require('../../middleware/current-user');

const router = express.Router();
router.use(requireUser);

router.get('/', async (req, res) => {
  res.json(await service.list(req.user, req.query));
});

router.get('/unread-count', async (req, res) => {
  res.json({ unread: await service.unreadCount(req.user) });
});

router.post('/read-all', async (req, res) => {
  await service.markAllRead(req.user);
  res.status(204).end();
});

router.post('/:id/read', async (req, res) => {
  await service.markRead(req.user, req.params.id);
  res.status(204).end();
});

module.exports = router;
