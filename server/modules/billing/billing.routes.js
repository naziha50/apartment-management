'use strict';
/**
 * Billing and payment API. Staff have no access to billing.
 *
 * GET    /api/v1/bills                      admin: every bill · resident: bills of their own units (FR-12)
 * POST   /api/v1/bills                      admin: create one bill with its first charge (FR-09)
 * POST   /api/v1/bills/generate             admin: bills for every occupied unit for a month (FR-09)
 * GET    /api/v1/bills/:id                  one bill with its charges and payments (FR-10)
 * POST   /api/v1/bills/:id/charges          admin: add a charge (FR-10)
 * DELETE /api/v1/bills/:id/charges/:chargeId admin: remove a charge (FR-10)
 * POST   /api/v1/bills/:id/payment          admin: record a payment, full or partial (FR-11)
 * GET    /api/v1/payments                   admin: all payments · resident: their own (FR-13)
 * GET    /api/v1/payments/:id               one payment, for the receipt (FR-14)
 * GET    /api/v1/billing/report             admin: totals and unpaid dues (FR-15)
 * GET    /api/v1/billing/units              admin: units for the "Create a bill" form
 */
const express = require('express');
const config = require('../../config');
const db = require('../../db/pool');
const bills = require('./billing.repository');
const { requireUser } = require('../../middleware/current-user');
const { badRequest, forbidden, notFound, conflict } = require('../../lib/errors');

const router = express.Router();

const PAYMENT_METHODS = ['cash', 'bkash', 'bank'];
const BILL_TYPES = ['service_charge', 'rent', 'utility', 'other'];

/** Stops the request unless the current user is the admin. */
function requireAdmin(req, res, next) {
  return req.user.role === 'admin' ? next() : next(forbidden('Only the admin can do this.'));
}

/** Stops the request unless the user is the admin or a resident (staff get 403). */
function requireAdminOrResident(req, res, next) {
  if (req.user.role === 'admin' || req.user.role === 'resident') return next();
  return next(forbidden('Billing is only available to the admin and residents.'));
}

/** True for a real calendar date written as YYYY-MM-DD (rejects 2026-02-30). */
function isValidDate(text) {
  if (typeof text !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return false;
  const date = new Date(`${text}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().startsWith(text);
}

/** True for a month written as YYYY-MM, like 2026-11. */
function isValidMonth(text) {
  return typeof text === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(text);
}

/** Today's date in Bangladesh as YYYY-MM-DD (the 'en-CA' format happens to be YYYY-MM-DD). */
function today() {
  return new Date().toLocaleDateString('en-CA', { timeZone: config.timezone });
}

/** The id from the URL as a number, or null if it is not a whole number. */
function readId(text) {
  const id = Number(text);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

/** For residents: their own id, so queries only return their units. Admin: null (no limit). */
function residentFilter(user) {
  return user.role === 'resident' ? user.id : null;
}

/** Checks the fields shared by "create a bill" and "generate bills" (FR-09). Returns the errors found. */
function checkBillFields(body) {
  const errors = {};
  if (!BILL_TYPES.includes(body.billType)) errors.billType = 'Choose a bill type.';
  if (!isValidMonth(body.month)) errors.month = 'Choose a month.';
  if (!isValidDate(body.dueDate)) errors.dueDate = 'Enter a valid due date.';
  if (!Number.isInteger(body.amount) || body.amount <= 0) errors.amount = 'Enter the amount in whole taka, more than 0.';
  if (typeof body.description !== 'string' || body.description.trim() === '') errors.description = 'Enter a description.';
  else if (body.description.trim().length > 200) errors.description = 'Keep the description under 200 characters.';
  return errors;
}

// ---------- Bills ----------

// List bills (FR-12). What you see depends on who you are.
router.get('/bills', requireUser, requireAdminOrResident, async (req, res) => {
  const list = req.user.role === 'admin'
    ? await bills.listAll(req.user.buildingId)
    : await bills.listForResident(req.user.id);
  res.json({ items: list });
});

// Create one bill for one unit, with its first charge (FR-09).
router.post('/bills', requireUser, requireAdmin, async (req, res) => {
  const body = req.body;
  const errors = checkBillFields(body);
  if (!Number.isInteger(body.unitId) || !(await bills.unitExists(body.unitId, req.user.buildingId))) {
    errors.unitId = 'Choose a unit.';
  }
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  let id;
  try {
    id = await db.withTransaction((client) => bills.createBillWithCharge(client, {
      buildingId: req.user.buildingId,
      unitId: body.unitId,
      billType: body.billType,
      billMonth: `${body.month}-01`,
      dueDate: body.dueDate,
      amount: body.amount,
      description: body.description.trim(),
      createdBy: req.user.id,
    }));
  } catch (err) {
    // 23505 = unique violation: this unit already has this type of bill for this month.
    if (err.code === '23505') throw conflict('That unit already has a bill of this type for this month.');
    throw err;
  }
  res.status(201).json({ bill: await bills.findById(id, req.user.buildingId, null) });
});

// Generate the monthly bills for every occupied unit (FR-09). All or nothing (NFR-08).
router.post('/bills/generate', requireUser, requireAdmin, async (req, res) => {
  const body = req.body;
  const errors = checkBillFields(body);
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  const result = await db.withTransaction(async (client) => {
    const units = await bills.listOccupiedUnits(client, req.user.buildingId);
    let created = 0;
    const skipped = []; // unit numbers that already had this bill
    for (const unit of units) {
      if (await bills.billExists(client, unit.id, body.billType, `${body.month}-01`)) {
        skipped.push(unit.unitNumber);
        continue;
      }
      await bills.createBillWithCharge(client, {
        buildingId: req.user.buildingId,
        unitId: unit.id,
        billType: body.billType,
        billMonth: `${body.month}-01`,
        dueDate: body.dueDate,
        amount: body.amount,
        description: body.description.trim(),
        createdBy: req.user.id,
      });
      created += 1;
    }
    return { created, skipped };
  });
  res.status(201).json(result);
});

// One bill with its charges and payments (FR-10). A resident only gets their own units' bills.
router.get('/bills/:id', requireUser, requireAdminOrResident, async (req, res) => {
  const id = readId(req.params.id);
  const bill = id ? await bills.findById(id, req.user.buildingId, residentFilter(req.user)) : null;
  if (!bill) throw notFound('We could not find that bill.');
  res.json({
    bill,
    charges: await bills.listCharges(id),
    payments: await bills.listPaymentsForBill(id),
  });
});

// ---------- Charges (FR-10) ----------

router.post('/bills/:id/charges', requireUser, requireAdmin, async (req, res) => {
  const id = readId(req.params.id);
  const { chargeType, description, amount } = req.body;

  const errors = {};
  if (!BILL_TYPES.includes(chargeType)) errors.chargeType = 'Choose a charge type.';
  if (typeof description !== 'string' || description.trim() === '') errors.description = 'Enter a description.';
  else if (description.trim().length > 200) errors.description = 'Keep the description under 200 characters.';
  if (!Number.isInteger(amount) || amount <= 0) errors.amount = 'Enter the amount in whole taka, more than 0.';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  await db.withTransaction(async (client) => {
    if (!id || !(await bills.lockBill(client, id, req.user.buildingId))) throw notFound('We could not find that bill.');
    await bills.addCharge(client, { billId: id, chargeType, description: description.trim(), amount });
  });
  res.status(201).json({ bill: await bills.findById(id, req.user.buildingId, null) });
});

router.delete('/bills/:id/charges/:chargeId', requireUser, requireAdmin, async (req, res) => {
  const id = readId(req.params.id);
  const chargeId = readId(req.params.chargeId);

  await db.withTransaction(async (client) => {
    if (!id || !(await bills.lockBill(client, id, req.user.buildingId))) throw notFound('We could not find that bill.');
    const charge = chargeId ? await bills.findCharge(client, id, chargeId) : null;
    if (!charge) throw notFound('We could not find that charge.');

    // The total must not drop below what has already been paid.
    const { total, paid } = await bills.getTotals(client, id);
    if (total - charge.amount < paid) {
      throw conflict('This charge cannot be removed because the bill would then cost less than what has already been paid.');
    }
    await bills.deleteCharge(client, chargeId);
  });
  res.json({ bill: await bills.findById(id, req.user.buildingId, null) });
});

// ---------- Payments (FR-11) ----------

// Record a payment. It can be part of the balance, but never more than the balance.
router.post('/bills/:id/payment', requireUser, requireAdmin, async (req, res) => {
  const id = readId(req.params.id);
  const { amount, method } = req.body;
  const paidOn = req.body.paidOn || today();

  const errors = {};
  if (!Number.isInteger(amount) || amount <= 0) errors.amount = 'Enter the amount in whole taka, more than 0.';
  if (!PAYMENT_METHODS.includes(method)) errors.method = 'Choose cash, bKash or bank.';
  if (!isValidDate(paidOn)) errors.paidOn = 'Enter a valid payment date.';
  else if (paidOn > today()) errors.paidOn = 'The payment date cannot be in the future.';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  // The bill row is locked, so two payments at the same moment cannot add up to more than the balance.
  const paymentId = await db.withTransaction(async (client) => {
    if (!id || !(await bills.lockBill(client, id, req.user.buildingId))) throw notFound('We could not find that bill.');
    const { total, paid } = await bills.getTotals(client, id);
    const balance = total - paid;
    if (balance <= 0) throw badRequest('Please fix the highlighted fields.', { amount: 'This bill has nothing left to pay.' });
    if (amount > balance) {
      throw badRequest('Please fix the highlighted fields.', { amount: `The amount cannot be more than the balance of ৳${balance}.` });
    }
    return bills.createPayment(client, { billId: id, amount, method, paidOn, recordedBy: req.user.id });
  });
  res.status(201).json({ paymentId, bill: await bills.findById(id, req.user.buildingId, null) });
});

// List payments (FR-13): admin sees all, a resident sees their own.
router.get('/payments', requireUser, requireAdminOrResident, async (req, res) => {
  const list = req.user.role === 'admin'
    ? await bills.listAllPayments(req.user.buildingId)
    : await bills.listPaymentsForResident(req.user.id);
  res.json({ items: list });
});

// One payment with the details a receipt shows (FR-14).
router.get('/payments/:id', requireUser, requireAdminOrResident, async (req, res) => {
  const id = readId(req.params.id);
  const payment = id ? await bills.findPaymentForReceipt(id, req.user.buildingId, residentFilter(req.user)) : null;
  if (!payment) throw notFound('We could not find that receipt.');
  res.json({ payment });
});

// ---------- Report and units ----------

// Totals for a range of months, plus the units that owe money today (FR-15).
router.get('/billing/report', requireUser, requireAdmin, async (req, res) => {
  const from = req.query.from || null;
  const to = req.query.to || null;

  const errors = {};
  if (from && !isValidMonth(from)) errors.from = 'Choose a valid month.';
  if (to && !isValidMonth(to)) errors.to = 'Choose a valid month.';
  if (!errors.from && !errors.to && from && to && from > to) errors.to = 'The end month cannot be before the start month.';
  if (Object.keys(errors).length) throw badRequest('Please fix the highlighted fields.', errors);

  res.json({
    ...(await bills.getSummary(req.user.buildingId, from, to)),
    unitsWithDues: await bills.listUnitsWithDues(req.user.buildingId),
  });
});

// Units for the "Create a bill" form.
router.get('/billing/units', requireUser, requireAdmin, async (req, res) => {
  res.json({ items: await bills.listUnits(req.user.buildingId) });
});

module.exports = router;
