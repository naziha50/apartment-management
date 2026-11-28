'use strict';
/**
 * GET /api/v1/dev/users  demo users (development only; not available on a live server)
 * GET /api/v1/me         the logged-in user (401 if nobody is logged in)
 */
const express = require('express');
const users = require('./users.repository');
const { requireUser, devStandInEnabled } = require('../../middleware/current-user');

const router = express.Router();

router.get('/dev/users', async (req, res, next) => {
  if (!devStandInEnabled) return next(); // the user list (with emails) is a development aid only
  const list = await users.listActive();
  res.json({ items: list.map(({ id, fullName, role, email }) => ({ id, fullName, role, email })) });
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
