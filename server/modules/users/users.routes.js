'use strict';
/**
 * GET /api/v1/dev/users  people you can "view as" (development stand-in for login)
 * GET /api/v1/me         the user you are currently viewing as
 */
const express = require('express');
const users = require('./users.repository');
const { requireUser } = require('../../middleware/current-user');

const router = express.Router();

router.get('/dev/users', async (req, res) => {
  const list = await users.listActive();
  res.json({ items: list.map(({ id, fullName, role, email }) => ({ id, fullName, role, email })) });
});

router.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user });
});

module.exports = router;
