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

// FR-18
const PRIORITIES = Object.freeze(['low', 'medium', 'high']);

module.exports = { CATEGORIES, LOCATIONS, STATUSES, FINAL_STATUSES, PRIORITIES };
