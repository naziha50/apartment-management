'use strict';
/** Unit tests for the request status rules (BR-16, Appendix A). Run with `npm test`. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { allowedTransitions, findTransition, canAssign, canAddNote, canSetPriority, ratingProblem, canRate, deadline, isOverdue } = require('../server/modules/maintenance/state-machine');

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

test('notes come from the admin, the assignee or a reviewer, until the request is finished', () => {
  const r = req({ status: 'in_progress', assigned_to: 3 });
  assert.equal(canAddNote(r, admin), true);
  assert.equal(canAddNote(r, caretaker), true); // assigned
  assert.equal(canAddNote(r, reviewer), true);
  assert.equal(canAddNote(r, { ...caretaker, id: 9 }), false); // other staff
  assert.equal(canAddNote(r, resident), false);
  assert.equal(canAddNote(req({ status: 'resolved', assigned_to: 3 }), caretaker), true);
  for (const status of ['closed', 'rejected', 'cancelled']) {
    assert.equal(canAddNote(req({ status, assigned_to: 3 }), admin), false, status);
  }
});

test('reviewers change the priority only after review and before it is resolved', () => {
  for (const status of ['under_review', 'in_progress']) {
    assert.equal(canSetPriority(req({ status, assigned_to: 3 }), admin), true, status);
    assert.equal(canSetPriority(req({ status, assigned_to: 3 }), reviewer), true, status);
    assert.equal(canSetPriority(req({ status, assigned_to: 3 }), caretaker), false, status); // even when assigned
    assert.equal(canSetPriority(req({ status }), resident), false, status);
  }
  for (const status of ['submitted', 'resolved', 'closed', 'rejected', 'cancelled']) {
    assert.equal(canSetPriority(req({ status }), admin), false, status);
  }
});

test('the reporting resident rates once, after closing, within 7 days', () => {
  const now = new Date('2026-11-15T12:00:00Z');
  const closed = req({ status: 'closed', closed_at: '2026-11-12T12:00:00Z' });
  assert.equal(canRate(closed, resident, { now }), true);
  assert.match(ratingProblem(closed, neighbour, { now }), /Only the resident who reported it/);
  assert.match(ratingProblem(closed, admin, { now }), /Only the resident who reported it/);
  assert.match(ratingProblem(closed, resident, { now, alreadyRated: true }), /already been rated/);
  assert.match(ratingProblem(req({ status: 'resolved' }), resident, { now }), /once it is closed/);
  assert.match(ratingProblem(req({ status: 'closed', closed_at: '2026-11-07T12:00:00Z' }), resident, { now }), /within 7 days/);
});

test('final statuses allow no moves', () => {
  for (const status of ['closed', 'rejected', 'cancelled']) {
    for (const u of [admin, reviewer, caretaker, resident]) {
      assert.deepEqual(moves(req({ status, assigned_to: 3 }), u), [], `${status} / ${u.role}`);
    }
  }
});

test('overdue: priority sets the deadline, only while the request still needs action (BR-17)', () => {
  const submitted_at = '2026-11-10T00:00:00Z';
  const at = (iso) => new Date(iso);
  assert.equal(deadline(req({ submitted_at, priority: 'high' })).toISOString(), '2026-11-11T00:00:00.000Z');
  assert.equal(deadline(req({ submitted_at, priority: 'medium' })).toISOString(), '2026-11-13T00:00:00.000Z');
  assert.equal(deadline(req({ submitted_at, priority: 'low' })).toISOString(), '2026-11-17T00:00:00.000Z');
  assert.equal(deadline(req({ submitted_at, priority: null })).toISOString(), '2026-11-12T00:00:00.000Z', 'not reviewed: 2 days');

  const high = req({ submitted_at, priority: 'high', status: 'in_progress' });
  assert.equal(isOverdue(high, at('2026-11-10T23:59:00Z')), false);
  assert.equal(isOverdue(high, at('2026-11-11T00:01:00Z')), true);
  assert.equal(isOverdue(req({ submitted_at, status: 'submitted' }), at('2026-11-12T00:01:00Z')), true);
  for (const status of ['resolved', 'closed', 'rejected', 'cancelled']) {
    assert.equal(isOverdue(req({ submitted_at, priority: 'high', status }), at('2026-12-01T00:00:00Z')), false, status);
  }
});

test('a request from a scheduled task is due at the end of its due day in Dhaka, whatever its priority (BR-25)', () => {
  const r = req({ submitted_at: '2026-11-01T00:00:00Z', priority: 'high', status: 'under_review', due_date: '2026-11-20' });
  assert.equal(deadline(r).toISOString(), '2026-11-20T18:00:00.000Z', 'midnight after 20 Nov in Dhaka (UTC+6)');
  assert.equal(isOverdue(r, new Date('2026-11-20T17:59:00Z')), false, 'not overdue on its due day, even past the 24-hour target');
  assert.equal(isOverdue(r, new Date('2026-11-20T18:01:00Z')), true);
});
