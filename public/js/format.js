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

// The server sends days ('2026-12-16') and times ('2026-12-16T14:05:00.000+06:00') already in the
// app's time zone, so they are shown exactly as sent: the browser's own time zone plays no part.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const PARTS = /^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/;

/** '2026-12-16…' → '16 Dec 2026' */
export function formatDate(value) {
  const m = value && PARTS.exec(value);
  return m ? `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}` : '—';
}

/** '2026-12-16T14:05…' → '16 Dec 2026, 14:05' */
export function formatDateTime(value) {
  const m = value && PARTS.exec(value);
  return m ? `${formatDate(value)}${m[4] ? `, ${m[4]}:${m[5]}` : ''}` : '—';
}
