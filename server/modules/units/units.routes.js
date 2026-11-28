'use strict';
/**
 * Apartments and occupancy (mounted at /api/v1/units), admin only.
 *
 *   GET  /                              all units with their current residents
 *   POST /                              add a unit
 *   GET  /residents                     active residents, for the "assign" picker
 *   GET  /:id                           one unit with its history
 *   POST /:id/occupancies               assign a resident (owner or tenant)
 *   POST /occupancies/:id/move-out      record the last day of a stay
 */
const express = require('express');
const service = require('./units.service');
const { requireUser } = require('../../middleware/current-user');
const { forbidden } = require('../../lib/errors');

const router = express.Router();
router.use(requireUser, (req, res, next) => (req.user.role === 'admin' ? next() : next(forbidden('Only the admin can manage apartments.'))));

router.get('/', async (req, res) => {
  res.json(await service.list(req.user));
});

router.post('/', async (req, res) => {
  res.status(201).json({ unit: await service.create(req.user, req.body) });
});

router.get('/residents', async (req, res) => {
  res.json({ items: await service.activeResidents(req.user) });
});

router.get('/:id', async (req, res) => {
  res.json({ unit: await service.get(req.user, req.params.id) });
});

router.post('/:id/occupancies', async (req, res) => {
  res.status(201).json({ unit: await service.assign(req.user, req.params.id, req.body) });
});

router.post('/occupancies/:id/move-out', async (req, res) => {
  res.json({ unit: await service.moveOut(req.user, req.params.id, req.body) });
});

module.exports = router;
