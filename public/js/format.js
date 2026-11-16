/**
 * Display names and formats for maintenance data. The value lists match
 * server/modules/maintenance/maintenance.constants.js.
 */
import { el } from './dom.js';

// FR-16
export const CATEGORY_LABELS = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  lift: 'Lift',
  generator: 'Generator',
  water_supply: 'Water supply',
  gas: 'Gas',
  cleaning: 'Cleaning',
  security: 'Security',
  common_area: 'Common area',
  other: 'Other',
};

// BR-16
export const STATUS_LABELS = {
  submitted: 'Submitted',
  under_review: 'Under review',
  in_progress: 'In progress',
  resolved: 'Resolved',
  closed: 'Closed',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

// FR-18
export const PRIORITY_LABELS = { high: 'High', medium: 'Medium', low: 'Low' };

// Statuses where the office or staff still have to act; a list filter value (?status=…).
export const NEEDS_ACTION = 'submitted,under_review,in_progress';

export const LOCATION_LABELS = { unit: 'Inside the apartment', common_area: 'Common area' };

export const categoryLabel = (c) => CATEGORY_LABELS[c] || c;

/** Status as a coloured badge; the text carries the meaning, not the colour (UI-06). */
export const statusBadge = (s) => el('span', { class: `badge status-${s}`, text: STATUS_LABELS[s] || s });

/** BR-17: shown next to the status when a request has passed its target time. */
export const overdueBadge = () => el('span', { class: 'badge badge-overdue', text: 'Overdue' });

export const priorityBadge = (p) =>
  el('span', { class: `badge prio-${p || 'unset'}`, text: p ? PRIORITY_LABELS[p] : 'Not set yet' });

// All dates and times in the SRS are Bangladesh time (§2.6), wherever the viewer is.
const TIME_ZONE = 'Asia/Dhaka';
const DATE_TIME = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: TIME_ZONE });
const DATE = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: TIME_ZONE });

export const formatDateTime = (iso) => (iso ? DATE_TIME.format(new Date(iso)) : '—');
export const formatDate = (iso) => (iso ? DATE.format(new Date(iso)) : '—');
