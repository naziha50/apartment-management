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
const { FINAL_STATUSES, NEEDS_ACTION, RESOLVED_DAYS, RATING_DAYS, TARGET_HOURS } = require('./maintenance.constants');

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

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
  // Appendix A / BR-25: a request from a scheduled task has no resident to confirm it, so the admin closes it.
  { from: ['resolved'], to: 'closed', kind: 'office_close', who: (r, u) => r.scheduled_task_id != null && isAdmin(u) },
  {
    from: ['resolved'],
    to: 'in_progress',
    needs: 'note',
    kind: 'reopen',
    who: (r, u, now) => isSubmitter(r, u) && withinDays(r.resolved_at, RESOLVED_DAYS, now),
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

/**
 * FR-50 / BR-26: why this user may not rate this request now, or null when they may.
 * The resident who reported it rates once, after it is closed, within RATING_DAYS.
 */
function ratingProblem(request, user, { alreadyRated = false, now = new Date() } = {}) {
  if (request.scheduled_task_id != null) return 'Requests from a scheduled task are not rated.';
  if (!isSubmitter(request, user)) return 'Only the resident who reported it can rate it.';
  if (alreadyRated) return 'This request has already been rated.';
  if (request.status !== 'closed') return 'You can rate a request once it is closed.';
  if (!withinDays(request.closed_at, RATING_DAYS, now)) return `Ratings can be given within ${RATING_DAYS} days of closing.`;
  return null;
}

const canRate = (request, user, ctx) => ratingProblem(request, user, ctx) === null;

/**
 * BR-17: when the request must be resolved (or, without a priority, reviewed) by.
 * BR-25: a request from a scheduled task is due by the end of the task's due day
 * (a 'YYYY-MM-DD' Bangladesh day, UTC+6), not by the priority target.
 */
const deadline = (request) =>
  request.due_date
    ? new Date(Date.parse(`${request.due_date}T00:00:00+06:00`) + DAY_MS)
    : new Date(new Date(request.submitted_at).getTime() + TARGET_HOURS[request.priority || 'unset'] * HOUR_MS);

/** BR-17: still needs action and its deadline has passed. Same rule as OVERDUE_SQL in the repository. */
const isOverdue = (request, now = new Date()) => NEEDS_ACTION.includes(request.status) && deadline(request) < now;

module.exports = { allowedTransitions, findTransition, canAssign, canAddNote, canSetPriority, ratingProblem, canRate, deadline, isOverdue };
