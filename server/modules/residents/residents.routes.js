'use strict';
/**
 * Resident accounts (mounted at /api/v1/residents), admin only.
 *
 *   GET   /                  list (?q=, ?status=active|inactive, ?page=)
 *   POST  /                  add a resident
 *   GET   /:id               one resident
 *   PATCH /:id               edit
 *   POST  /:id/deactivate    deactivate (kept, but can no longer use the system)
 *   POST  /:id/reactivate    make active again
 */
const express = require('express');
const service = require('./residents.service');
const { requireUser } = require('../../middleware/current-user');
const { forbidden } = require('../../lib/errors');

const router = express.Router();
router.use(requireUser, (req, res, next) => (req.user.role === 'admin' ? next() : next(forbidden('Only the admin can manage residents.'))));

router.get('/', async (req, res) => {
  res.json(await service.list(req.user, req.query));
});

router.post('/', async (req, res) => {
  res.status(201).json({ resident: await service.create(req.user, req.body) });
});

router.get('/:id', async (req, res) => {
  res.json({ resident: await service.get(req.user, req.params.id) });
});

router.patch('/:id', async (req, res) => {
  res.json({ resident: await service.update(req.user, req.params.id, req.body) });
});

router.post('/:id/deactivate', async (req, res) => {
  res.json({ resident: await service.setActive(req.user, req.params.id, false) });
});

router.post('/:id/reactivate', async (req, res) => {
  res.json({ resident: await service.setActive(req.user, req.params.id, true) });
});

module.exports = router;
