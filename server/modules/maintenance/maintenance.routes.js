'use strict';
/**
 * Maintenance REST endpoints (mounted at /api/v1/maintenance).
 *
 *   POST /requests   submit a request (residents)          FR-16, FR-17
 *                    JSON, or multipart with up to 3 `photos` (BR-19)
 *   GET  /my-units   the resident's active apartments      FR-17
 *   GET  /requests   requests the user may see             FR-21
 *   GET  /requests/:id  one request with its history       FR-21
 *   GET  /requests/:id/attachments/:attId  one photo       BR-19
 *   POST /requests/:id/transition  change status           FR-18, FR-20, BR-16
 *                    body { to, priority?, note? }
 *   POST /requests/:id/assign  assign to staff            FR-19
 *                    body { staffId }
 *   GET  /staff      staff that requests can be assigned to FR-19
 *   POST /requests/:id/notes  add a progress note           FR-20
 *                    body { note, internal? }
 *
 * Routes only handle HTTP; every rule is checked in maintenance.service.js,
 * so no route can skip it (NFR-02).
 */
const express = require('express');
const service = require('./maintenance.service');
const { photosField } = require('./uploads');
const { requireUser } = require('../../middleware/current-user');

const router = express.Router();
router.use(requireUser);

router.post('/requests', photosField, async (req, res) => {
  res.status(201).json(await service.createRequest(req.user, req.body, req.files));
});

router.get('/requests', async (req, res) => {
  res.json({ items: await service.listRequests(req.user) });
});

router.get('/requests/:id', async (req, res) => {
  res.json(await service.getRequest(req.user, req.params.id));
});

// Photos are private: served only through the API, never from /public (NFR-23).
router.get('/requests/:id/attachments/:attId', async (req, res) => {
  const photo = await service.getAttachment(req.user, req.params.id, req.params.attId);
  res.set('Content-Type', photo.mimeType);
  res.set('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(photo.name)}`);
  res.sendFile(photo.file);
});

router.post('/requests/:id/transition', async (req, res) => {
  res.json(await service.transition(req.user, req.params.id, req.body));
});

router.post('/requests/:id/assign', async (req, res) => {
  res.json(await service.assign(req.user, req.params.id, req.body));
});

router.post('/requests/:id/notes', async (req, res) => {
  res.status(201).json(await service.addNote(req.user, req.params.id, req.body));
});

router.get('/staff', async (req, res) => {
  res.json({ items: await service.staffList(req.user) });
});

router.get('/my-units', async (req, res) => {
  res.json({ items: await service.myUnits(req.user) });
});

module.exports = router;
