/**
 * Start page: explains who you are viewing as and what that role can do.
 * The maintenance links appear in the navigation as each feature is built.
 */
import { $, el, replace } from '../dom.js';
import { initLayout } from '../layout.js';
import { animateIn, errorState } from '../ui.js';

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
  }
  animateIn(card);
} catch (err) {
  replace(card, errorState(err, () => location.reload()));
}
