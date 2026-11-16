'use strict';
/**
 * Maintenance REST endpoints (mounted at /api/v1/maintenance).
 *
 *   POST /requests   submit a request (residents)          FR-16, FR-17
 *                    JSON, or multipart with up to 3 `photos` (BR-19)
 *   GET  /my-units   the resident's active apartments      FR-17
 *   GET  /requests   requests the user may see             FR-21
 *                    ?status=a,b&category=&priority=&q=&assigned=none&overdue=1&sort=oldest
 *                    &unitId=&assignedTo=&from=YYYY-MM-DD&to=YYYY-MM-DD&page=   FR-22, BR-17
 *   GET  /export.csv  the request list as CSV, same filters as /requests (admin, staff)   FR-38
 *   GET  /filter-options  units and staff for the list filters    FR-22
 *   GET  /report     ?from=&to= (YYYY-MM-DD) status counts, time to resolve,
 *                    busiest units, ratings per category and staff    FR-22, FR-50
 *   GET  /requests/:id  one request with its history       FR-21
 *   GET  /requests/:id/attachments/:attId  one photo       BR-19
 *   POST /requests/:id/transition  change status           FR-18, FR-20, BR-16
 *                    body { to, priority?, note? }
 *   POST /requests/:id/assign  assign to staff            FR-19
 *                    body { staffId }
 *   GET  /staff      staff that requests can be assigned to FR-19
 *   POST /requests/:id/notes  add a progress note           FR-20
 *                    body { note, internal? }, JSON or multipart with up to 3 `photos` (BR-19)
 *   PATCH /requests/:id/priority  change the priority     FR-18
 *                    body { priority }
 *   POST /requests/:id/rating  rate a closed request      FR-50, BR-26
 *                    body { rating: 1-5, comment? }
 *
 * Routes only handle HTTP; every rule is checked in maintenance.service.js,
 * so no route can skip it (NFR-02).
 */
const express = require('express');
const service = require('./maintenance.service');
const { photosField } = require('./uploads');
const { requireUser } = require('../../middleware/current-user');
const { notFound } = require('../../lib/errors');

const router = express.Router();
router.use(requireUser);

router.post('/requests', photosField, async (req, res) => {
  res.status(201).json(await service.createRequest(req.user, req.body, req.files));
});

router.get('/requests', async (req, res) => {
  res.json(await service.listRequests(req.user, req.query));
});

router.get('/export.csv', async (req, res) => {
  const { filename, body } = await service.exportRequests(req.user, req.query);
  res.set({
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store', // personal data: not kept by the browser or proxies
  });
  res.send(body);
});

router.get('/report', async (req, res) => {
  res.json(await service.report(req.user, req.query));
});

router.get('/filter-options', async (req, res) => {
  res.json(await service.filterOptions(req.user));
});

router.get('/requests/:id', async (req, res) => {
  res.json(await service.getRequest(req.user, req.params.id));
});

// Photos are private: served only through the API, never from /public (NFR-23).
router.get('/requests/:id/attachments/:attId', async (req, res, next) => {
  const photo = await service.getAttachment(req.user, req.params.id, req.params.attId);
  // Headers go through sendFile so an error reply is not labelled as an image.
  const headers = {
    'Content-Type': photo.mimeType,
    'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(photo.name)}`,
  };
  res.sendFile(photo.file, { headers }, (err) => {
    if (!err) return;
    // The database row exists but the file is gone (e.g. storage/uploads was cleared).
    next(err.code === 'ENOENT' ? notFound('We could not find that photo.') : err);
  });
});

router.post('/requests/:id/transition', async (req, res) => {
  res.json(await service.transition(req.user, req.params.id, req.body));
});

router.post('/requests/:id/assign', async (req, res) => {
  res.json(await service.assign(req.user, req.params.id, req.body));
});

router.post('/requests/:id/notes', photosField, async (req, res) => {
  res.status(201).json(await service.addNote(req.user, req.params.id, req.body, req.files));
});

router.post('/requests/:id/rating', async (req, res) => {
  res.status(201).json(await service.rate(req.user, req.params.id, req.body));
});

router.patch('/requests/:id/priority', async (req, res) => {
  res.json(await service.setPriority(req.user, req.params.id, req.body));
});

router.get('/overview', async (req, res) => {
  res.json(await service.overview(req.user));
});

router.get('/staff', async (req, res) => {
  res.json({ items: await service.staffList(req.user) });
});

router.get('/my-units', async (req, res) => {
  res.json({ items: await service.myUnits(req.user) });
});

module.exports = router;
