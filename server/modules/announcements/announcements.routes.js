'use strict';
/**
 * Announcements (mounted at /api/v1/announcements).
 *
 *   GET    /           admin: all, with read counts; resident: the ones they received (?page=)
 *   POST   /           admin: publish and notify every active resident
 *   PATCH  /:id        admin: edit
 *   DELETE /:id        admin: delete, with its notifications
 *   POST   /read-all   resident: mark all announcements read
 *
 * One announcement is marked read through POST /notifications/:id/read.
 */
const express = require('express');
const service = require('./announcements.service');
const { requireUser } = require('../../middleware/current-user');
const { forbidden } = require('../../lib/errors');

const only = (role, message) => (req, res, next) => (req.user.role === role ? next() : next(forbidden(message)));
const adminOnly = only('admin', 'Only the admin can manage announcements.');
const residentOnly = only('resident', 'Only residents have announcements to read.');

const router = express.Router();
router.use(requireUser);

router.get('/', async (req, res) => {
  if (!['admin', 'resident'].includes(req.user.role)) throw forbidden('Announcements are for residents.');
  res.json(await service.list(req.user, req.query));
});

router.post('/', adminOnly, async (req, res) => {
  res.status(201).json(await service.publish(req.user, req.body));
});

router.post('/read-all', residentOnly, async (req, res) => {
  await service.markAllRead(req.user);
  res.status(204).end();
});

router.patch('/:id', adminOnly, async (req, res) => {
  res.json({ announcement: await service.update(req.user, req.params.id, req.body) });
});

router.delete('/:id', adminOnly, async (req, res) => {
  await service.remove(req.user, req.params.id);
  res.status(204).end();
});

module.exports = router;
