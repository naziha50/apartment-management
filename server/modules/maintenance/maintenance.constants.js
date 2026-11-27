'use strict';
/**
 * Fixed lists for maintenance requests. They match the CHECK constraints and
 * enum types in db/migrations/002_create_maintenance_requests.sql.
 */

// FR-16
const CATEGORIES = Object.freeze([
  'plumbing', 'electrical', 'lift', 'generator', 'water_supply',
  'gas', 'cleaning', 'security', 'common_area', 'other',
]);

// FR-16: "inside my unit or in a common area"
const LOCATIONS = Object.freeze(['unit', 'common_area']);

// BR-16
const STATUSES = Object.freeze(['submitted', 'under_review', 'in_progress', 'resolved', 'closed', 'rejected', 'cancelled']);
const FINAL_STATUSES = Object.freeze(['closed', 'rejected', 'cancelled']);
// Someone in the office or on staff still has to act (assigning is allowed, the overview counts these).
const NEEDS_ACTION = Object.freeze(['submitted', 'under_review', 'in_progress']);

// BR-18: after a request is resolved, the resident has this many days to reopen it;
// after that it is closed automatically. One number for both, so they always agree.
const RESOLVED_DAYS = 7;

// BR-26: a closed request can be rated by its resident within this many days of closing.
const RATING_DAYS = 7;

// FR-18
const PRIORITIES = Object.freeze(['low', 'medium', 'high']);

// BR-17: hours from submission until a request still needing action is overdue.
// Without a priority it must at least be reviewed within 2 days.
// shortcut: fixed values; the SRS lets the admin change them in settings, which come with the settings module.
const TARGET_HOURS = Object.freeze({ high: 24, medium: 3 * 24, low: 7 * 24, unset: 2 * 24 });

// BR-25: a scheduled task becomes a request this many days before its due date;
// its repeat interval is 1 to MAX_INTERVAL_MONTHS months.
const SCHEDULE_LEAD_DAYS = 7;
const MAX_INTERVAL_MONTHS = 24;

module.exports = {
  CATEGORIES, LOCATIONS, STATUSES, FINAL_STATUSES, NEEDS_ACTION, RESOLVED_DAYS, RATING_DAYS, PRIORITIES, TARGET_HOURS,
  SCHEDULE_LEAD_DAYS, MAX_INTERVAL_MONTHS,
};
