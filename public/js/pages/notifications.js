/**
 * FR-25: my notifications, newest first, 25 per page. Unread ones are marked
 * "New" (in words, not only colour). Opening one marks it read, then goes to
 * its request or announcement.
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { formatDateTime } from '../format.js';
import { initLayout, setBellCount } from '../layout.js';
import { animateList, emptyState, errorState, pagination, withBusy } from '../ui.js';

const card = $('#content');
const markAll = $('#mark-all');
let currentPage = 1;

/** Where a notification leads: its request, its announcement, or home. */
function linkFor(n) {
  if (n.requestId) return `/request.html?id=${n.requestId}`;
  return n.announcementId ? `/announcements.html#a-${n.announcementId}` : '/';
}

/** Marks an unread notification read before following its link (the link still works if that fails). */
async function open(event, n) {
  if (n.read) return;
  event.preventDefault();
  const { href } = event.currentTarget;
  await api.post(`/notifications/${n.id}/read`).catch(() => {});
  location.href = href;
}

async function load(page) {
  currentPage = page;
  try {
    const data = await api.get(`/notifications?page=${page}`);
    setBellCount(data.unread);
    markAll.hidden = !data.unread;
    if (!data.total) {
      replace(card, emptyState('No notifications yet.', 'Updates and announcements will appear here.'));
      return;
    }
    const items = data.items.map((n) =>
      el(
        'li',
        { class: n.read ? 'notice' : 'notice notice--unread' },
        el(
          'a',
          { href: linkFor(n), onclick: (e) => open(e, n) },
          n.read ? null : el('span', { class: 'notice__new', text: 'New' }),
          el('span', { class: 'notice__text', text: n.message }),
        ),
        el('time', { class: 'muted small', datetime: n.createdAt, text: formatDateTime(n.createdAt) }),
      ),
    );
    replace(
      card,
      el('ul', { class: 'notices' }, items),
      pagination(data, (next) => {
        load(next);
        $('#main').focus();
      }),
    );
    animateList(items);
  } catch (err) {
    replace(card, errorState(err, () => load(page)));
  }
}

markAll.addEventListener('click', () =>
  withBusy(markAll, async () => {
    await api.post('/notifications/read-all');
    await load(currentPage);
  }),
);

try {
  const user = await initLayout({ active: 'notifications' });
  if (!user) replace(card, emptyState('Choose a user first.', 'Pick a demo user in the “Viewing as” menu to see their notifications.'));
  else await load(1);
} catch (err) {
  replace(card, errorState(err, () => location.reload()));
}
