'use strict';
/**
 * Billing and payment API.
 *
 * GET  /api/v1/bills               admin: every bill · resident: bills for their own units
 * POST /api/v1/bills               admin: create a bill for a unit
 * POST /api/v1/bills/:id/payment   admin: record that a bill was paid
 * GET  /api/v1/billing/units       admin: list of units for the "Create a bill" form
 *
 * Staff have no access to billing.
 */
const express = require('express');
const config = require('../../config');
const bills = require('./billing.repository');
const { requireUser } = require('../../middleware/current-user');
const { badRequest, forbidden, notFound, conflict } = require('../../lib/errors');

const router = express.Router();

const PAYMENT_METHODS = ['cash', 'bkash', 'bank'];

/** Stops the request unless the current user is the admin. */
function requireAdmin(req, res, next) {
  return req.user.role === 'admin' ? next() : next(forbidden('Only the admin can do this.'));
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
function isValidDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

/** Today's date in Bangladesh as YYYY-MM-DD (the 'en-CA' format happens to be YYYY-MM-DD). */
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
}

// List bills. What you see depends on who you are.
router.get('/bills', requireUser, async (req, res) => {
  let list;
  if (req.user.role === 'admin') list = await bills.listAll(req.user.buildingId);
  else if (req.user.role === 'resident') list = await bills.listForResident(req.user.id);
  else throw forbidden('Billing is only available to the admin and residents.');
  res.json({ items: list });
});

// Create a bill.
router.post('/bills', requireUser, requireAdmin, async (req, res) => {
  const { unitId, title, amount, dueDate } = req.body;

  // Check every field and collect all problems, so the form can show them together.
  const errors = {};
  if (!Number.isInteger(unitId) || !(await bills.unitExists(unitId, req.user.buildingId))) {
    errors.unitId = 'Choose a unit.';
  }
  if (typeof title !== 'string' || title.trim() === '') errors.title = 'Enter a title.';
  else if (title.trim().length > 100) errors.title = 'Keep the title under 100 characters.';
  if (!Number.isInteger(amount) || amount <= 0) errors.amount = 'Enter the amount in whole taka, more than 0.';
  if (!isValidDate(dueDate)) errors.dueDate = 'Enter a valid due date.';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  const id = await bills.createBill({
    buildingId: req.user.buildingId,
    unitId,
    title: title.trim(),
    amount,
    dueDate,
    createdBy: req.user.id,
  });
  res.status(201).json({ bill: await bills.findById(id, req.user.buildingId) });
});

// Record a payment for a bill.
router.post('/bills/:id/payment', requireUser, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const bill = Number.isInteger(id) ? await bills.findById(id, req.user.buildingId) : null;
  if (!bill) throw notFound('We could not find that bill.');
  if (bill.status === 'paid') throw conflict('This bill has already been paid.');

  const { method } = req.body;
  const paidOn = req.body.paidOn || today();
  const errors = {};
  if (!PAYMENT_METHODS.includes(method)) errors.method = 'Choose cash, bKash or bank.';
  if (!isValidDate(paidOn)) errors.paidOn = 'Enter a valid payment date.';
  else if (paidOn > today()) errors.paidOn = 'The payment date cannot be in the future.';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  await bills.createPayment({ billId: id, method, paidOn, recordedBy: req.user.id });
  res.json({ bill: await bills.findById(id, req.user.buildingId) });
});

// Units for the "Create a bill" form.
router.get('/billing/units', requireUser, requireAdmin, async (req, res) => {
  res.json({ items: await bills.listUnits(req.user.buildingId) });
});

module.exports = router;
