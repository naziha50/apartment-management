'use strict';
/** Unit tests for the request status rules (BR-16, Appendix A). Run with `npm test`. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedTransitions, findTransition, canAssign } = require('../server/modules/maintenance/state-machine');

const admin = { id: 1, role: 'admin', permissions: [] };
const reviewer = { id: 2, role: 'staff', permissions: ['maintenance.review'] };
const caretaker = { id: 3, role: 'staff', permissions: [] };
const resident = { id: 4, role: 'resident', permissions: [] };
const neighbour = { id: 5, role: 'resident', permissions: [] };

const req = (fields) => ({ submitted_by: 4, assigned_to: null, resolved_at: null, ...fields });
const moves = (r, u, now) => allowedTransitions(r, u, now).map((t) => t.to).sort();

test('a new request: reviewers review or reject, the resident may cancel', () => {
  const r = req({ status: 'submitted' });
  assert.deepEqual(moves(r, admin), ['rejected', 'under_review']);
  assert.deepEqual(moves(r, reviewer), ['rejected', 'under_review']);
  assert.deepEqual(moves(r, resident), ['cancelled']);
  assert.deepEqual(moves(r, caretaker), []);
  assert.deepEqual(moves(r, neighbour), []);
  assert.equal(findTransition(r, admin, 'under_review').needs, 'priority');
  assert.equal(findTransition(r, admin, 'rejected').needs, 'reason');
});

test('work cannot start until someone is assigned', () => {
  assert.deepEqual(moves(req({ status: 'under_review' }), admin), ['rejected']);
  const assigned = req({ status: 'under_review', assigned_to: 3 });
  assert.deepEqual(moves(assigned, admin), ['in_progress', 'rejected']);
  assert.deepEqual(moves(assigned, caretaker), ['in_progress']);
  assert.deepEqual(moves(assigned, { ...caretaker, id: 9 }), []); // other staff
});

test('only the assignee or admin resolves, and a note is required', () => {
  const r = req({ status: 'in_progress', assigned_to: 3 });
  assert.equal(findTransition(r, caretaker, 'resolved').needs, 'note');
  assert.ok(findTransition(r, admin, 'resolved'));
  assert.equal(findTransition(r, resident, 'resolved'), null);
});

test('the resident confirms, or reopens within 7 days', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const r = req({ status: 'resolved', resolved_at: '2026-11-10T12:00:00Z' });
  assert.deepEqual(moves(r, resident, now), ['closed', 'in_progress']);
  assert.equal(findTransition(r, resident, 'in_progress', now).kind, 'reopen');
  assert.deepEqual(moves(r, neighbour, now), []);
  assert.deepEqual(moves(r, admin, now), []);

  const old = req({ status: 'resolved', resolved_at: '2026-11-01T12:00:00Z' });
  assert.deepEqual(moves(old, resident, now), ['closed']);
});

test('only the admin or staff with maintenance.assign can assign, while the request is open', () => {
  const assigner = { id: 6, role: 'staff', permissions: ['maintenance.assign'] };
  for (const status of ['submitted', 'under_review', 'in_progress']) {
    assert.equal(canAssign(req({ status }), admin), true, status);
    assert.equal(canAssign(req({ status }), assigner), true, status);
    assert.equal(canAssign(req({ status }), reviewer), false, status);
    assert.equal(canAssign(req({ status }), caretaker), false, status);
    assert.equal(canAssign(req({ status }), resident), false, status);
  }
  for (const status of ['resolved', 'closed', 'rejected', 'cancelled']) {
    assert.equal(canAssign(req({ status }), admin), false, status);
  }
});

test('final statuses allow no moves', () => {
  for (const status of ['closed', 'rejected', 'cancelled']) {
    for (const u of [admin, reviewer, caretaker, resident]) {
      assert.deepEqual(moves(req({ status, assigned_to: 3 }), u), [], `${status} / ${u.role}`);
    }
  }
});
