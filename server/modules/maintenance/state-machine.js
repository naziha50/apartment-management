'use strict';
/**
 * Who may move a maintenance request to which status (BR-16, SRS Appendix A).
 * Plain functions with no database access, so every rule is unit-tested
 * directly (tests/state-machine.test.js).
 *
 *   submitted ──review──► under_review ──start work──► in_progress ──resolve──► resolved ──confirm──► closed
 *       │                     │                             ▲                      │
 *       ├─► cancelled         └─► rejected                  └──── reopen ──────────┘
 *       └─► rejected
 */
const { can } = require('../../middleware/current-user');
const { FINAL_STATUSES, NEEDS_ACTION } = require('./maintenance.constants');

// BR-18: a resident may reopen a resolved request within this many days.
const REOPEN_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1000;

const isAdmin = (user) => user?.role === 'admin';
const isReviewer = (user) => isAdmin(user) || (user?.role === 'staff' && can(user, 'maintenance.review'));
const isAssignedStaff = (req, user) => user?.role === 'staff' && req.assigned_to != null && Number(req.assigned_to) === user.id;
const isSubmitter = (req, user) => user?.role === 'resident' && req.submitted_by != null && Number(req.submitted_by) === user.id;

function withinDays(since, days, now) {
  return since != null && now.getTime() - new Date(since).getTime() <= days * DAY_MS;
}

/**
 * Every move in Appendix A. `needs` says what extra input the move requires:
 * 'priority' (review, FR-18), 'reason' (reject, FR-18) or 'note' (resolve / reopen, FR-20).
 */
const TRANSITIONS = Object.freeze([
  { from: ['submitted'], to: 'under_review', needs: 'priority', who: (r, u) => isReviewer(u) },
  { from: ['submitted'], to: 'cancelled', who: (r, u) => isSubmitter(r, u) },
  { from: ['submitted', 'under_review'], to: 'rejected', needs: 'reason', who: (r, u) => isReviewer(u) },
  // Somebody must be responsible before work starts (FR-19).
  { from: ['under_review'], to: 'in_progress', who: (r, u) => r.assigned_to != null && (isAdmin(u) || isAssignedStaff(r, u)) },
  { from: ['in_progress'], to: 'resolved', needs: 'note', who: (r, u) => isAdmin(u) || isAssignedStaff(r, u) },
  { from: ['resolved'], to: 'closed', who: (r, u) => isSubmitter(r, u) },
  {
    from: ['resolved'],
    to: 'in_progress',
    needs: 'note',
    kind: 'reopen',
    who: (r, u, now) => isSubmitter(r, u) && withinDays(r.resolved_at, REOPEN_DAYS, now),
  },
]);

/** The moves this user may make on this request right now. The page shows only these buttons (FR-20). */
function allowedTransitions(request, user, now = new Date()) {
  return TRANSITIONS.filter((t) => t.from.includes(request.status) && t.who(request, user, now)).map((t) => ({
    to: t.to,
    needs: t.needs || null,
    kind: t.kind || null,
  }));
}

/** The allowed move to `to`, or null when this user may not make it. */
function findTransition(request, user, to, now = new Date()) {
  return allowedTransitions(request, user, now).find((t) => t.to === to) || null;
}

/** May this user assign or reassign this request to staff right now? Until it is resolved or finished. (FR-19, Appendix B) */
function canAssign(request, user) {
  return can(user, 'maintenance.assign') && NEEDS_ACTION.includes(request.status);
}

/** FR-20: progress notes from the admin, the assigned staff member or a reviewer, while the request is open. */
function canAddNote(request, user) {
  if (FINAL_STATUSES.includes(request.status)) return false;
  return isAdmin(user) || isAssignedStaff(request, user) || isReviewer(user);
}

/** FR-18: reviewers may change the priority after review, while work is still to be done. */
function canSetPriority(request, user) {
  return isReviewer(user) && ['under_review', 'in_progress'].includes(request.status);
}

module.exports = { REOPEN_DAYS, TRANSITIONS, allowedTransitions, findTransition, canAssign, canAddNote, canSetPriority };
