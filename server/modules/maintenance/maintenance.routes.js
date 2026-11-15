'use strict';
/**
 * Maintenance REST endpoints (mounted at /api/v1/maintenance).
 *
 *   POST /requests   submit a request (residents)          FR-16, FR-17
 *   GET  /my-units   the resident's active apartments      FR-17
 *   GET  /requests   requests the user may see             FR-21
 *   GET  /requests/:id  one request with its history       FR-21
 *
 * Routes only handle HTTP; every rule is checked in maintenance.service.js,
 * so no route can skip it (NFR-02).
 */
const express = require('express');
const service = require('./maintenance.service');
const { requireUser } = require('../../middleware/current-user');

const router = express.Router();
router.use(requireUser);

router.post('/requests', async (req, res) => {
  res.status(201).json(await service.createRequest(req.user, req.body));
});

router.get('/requests', async (req, res) => {
  res.json({ items: await service.listRequests(req.user) });
});

router.get('/requests/:id', async (req, res) => {
  res.json(await service.getRequest(req.user, req.params.id));
});

router.get('/my-units', async (req, res) => {
  res.json({ items: await service.myUnits(req.user) });
});

module.exports = router;
