/**
 * Start page: explains who you are viewing as and what that role can do.
 * The admin and staff who see all requests also get the maintenance
 * overview (FR-29): counts that link straight to the matching list.
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { NEEDS_ACTION } from '../format.js';
import { initLayout } from '../layout.js';
import { animateIn, countUp, errorState } from '../ui.js';

// [count from /maintenance/overview, label, filter for /manage/requests.html, highlight when > 0]
const TILES = [
  ['overdue', 'Overdue', '?overdue=1&sort=oldest', true],
  ['submitted', 'Waiting for review', '?status=submitted&sort=oldest', false],
  ['unassigned', 'Not assigned yet', `?status=${NEEDS_ACTION}&assigned=none`, false],
  ['high_open', 'High priority, still open', `?status=${NEEDS_ACTION}&priority=high`, true],
  ['in_progress', 'In progress', '?status=in_progress', false],
  ['resolved', 'Waiting for the resident to confirm', '?status=resolved', false],
];

async function showOverview() {
  const box = $('#overview');
  box.hidden = false;
  try {
    const counts = await api.get('/maintenance/overview');
    const tiles = TILES.map(([key, label, query, alert]) => {
      const value = el('span', { class: 'stat__value', text: '0' });
      const tile = el('a', { class: alert && counts[key] ? 'stat stat--alert' : 'stat', href: `/manage/requests.html${query}` }, value, el('span', { class: 'stat__label', text: label }));
      countUp(value, counts[key]);
      return tile;
    });
    replace(box, el('h2', { id: 'overview-title', text: 'Maintenance overview' }), el('div', { class: 'stats' }, tiles));
    animateIn(box);
  } catch (err) {
    replace(box, errorState(err, showOverview));
  }
}

const ROLE_TEXT = {
  admin: 'As the admin you can review, prioritise and assign every maintenance request.',
  staff: 'As staff you work on the requests assigned to you and update their progress.',
  resident: 'As a resident you report problems in your apartment or common areas and follow their progress.',
};

const PERMISSION_TEXT = {
  'maintenance.view_all': 'see all requests',
  'maintenance.review': 'review, prioritise and reject requests',
  'maintenance.assign': 'assign requests to staff',
};

const card = $('#who');

try {
  const user = await initLayout({ active: 'home' });
  if (!user) {
    replace(card, el('h2', { text: 'Welcome' }), el('p', { text: 'Choose a demo user in the “Viewing as” menu at the top to start.' }));
  } else {
    const extra = user.permissions.map((p) => PERMISSION_TEXT[p]).filter(Boolean);
    replace(
      card,
      el('h2', { text: `Hello, ${user.fullName}` }),
      el('p', { text: ROLE_TEXT[user.role] }),
      extra.length ? el('p', { class: 'muted', text: `You may also ${extra.join(' and ')}.` }) : null,
    );
    if (user.role === 'admin' || user.permissions.includes('maintenance.view_all')) showOverview();
  }
  animateIn(card);
} catch (err) {
  replace(card, errorState(err, () => location.reload()));
}
