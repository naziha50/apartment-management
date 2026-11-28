/**
 * The frame every page shares (UI-02): top bar with the building name and the
 * "Viewing as" menu, and a navigation bar that shows only the links for the
 * current user's role (FR-02). On phones the navigation folds into a menu
 * button (UI-03).
 *
 *   const user = await initLayout({ active: 'home' });   // user may be null
 */
import { api } from './api.js';
import { el, $, icon, replace } from './dom.js';
import { toast } from './ui.js';
import { initViewingAs } from './viewing-as.js';

// FR-25: how often an open page checks for new notifications. Checking (not pushing) works with any
// number of server processes and costs one small indexed count per open, visible tab.
const BELL_REFRESH_MS = 30 * 1000;
let lastUnread = null;

/** FR-25: shows the unread count on the bell (0 hides the number). Pages call it after marking read. */
export function setBellCount(unread) {
  const bell = $('#bell');
  if (!bell) return;
  const count = bell.querySelector('.bell__count');
  count.textContent = unread > 99 ? '99+' : String(unread);
  count.hidden = !unread;
  bell.setAttribute('aria-label', unread ? `Notifications, ${unread} unread` : 'Notifications');
  lastUnread = unread;
}

/** Re-reads the count; says so (also to screen readers) when something new arrived since the last check. */
async function refreshBell() {
  try {
    const { unread } = await api.get('/notifications/unread-count');
    if (lastUnread !== null && unread > lastUnread) {
      const fresh = unread - lastUnread;
      toast(fresh === 1 ? 'You have a new notification.' : `You have ${fresh} new notifications.`);
    }
    setBellCount(unread);
  } catch {
    /* offline or server busy: the next check tries again */
  }
}

const BUILDING_NAME = 'Green Valley Apartments';

/**
 * Navigation per role. Each later step adds the links for the pages it builds,
 * e.g. { key: 'requests', label: 'My requests', href: '/resident/requests.html' }.
 * `permission` hides a link from staff who were not granted it (Appendix B).
 */
const NAV = {
  none: [{ key: 'home', label: 'Home', href: '/' }],
  resident: [
    { key: 'home', label: 'Home', href: '/' },
    { key: 'requests', label: 'My requests', href: '/resident/requests.html' },
    { key: 'newRequest', label: 'Report a problem', href: '/resident/new-request.html' },
    { key: 'bills', label: 'My bills', href: '/bills.html' }, // FR-13
  ],
  staff: [
    { key: 'home', label: 'Home', href: '/' },
    { key: 'requests', label: 'Requests', href: '/manage/requests.html' },
    { key: 'report', label: 'Report', href: '/manage/report.html', permission: 'reports.view' }, // FR-22, Appendix B
    { key: 'tasks', label: 'Scheduled tasks', href: '/manage/scheduled-tasks.html', permission: 'maintenance.assign' }, // FR-49, Appendix B
  ],
  admin: [
    { key: 'home', label: 'Home', href: '/' },
    { key: 'residents', label: 'Residents', href: '/manage/residents.html' },
    { key: 'apartments', label: 'Apartments', href: '/manage/apartments.html' },
    { key: 'requests', label: 'Requests', href: '/manage/requests.html' },
    { key: 'report', label: 'Maintenance report', href: '/manage/report.html' },
    { key: 'tasks', label: 'Scheduled tasks', href: '/manage/scheduled-tasks.html' },
    { key: 'dashboard', label: 'Dashboard', href: '/dashboard.html' }, // FR-27 to FR-30
    { key: 'bills', label: 'Bills', href: '/bills.html' }, // FR-09 to FR-14
    { key: 'billingReport', label: 'Billing report', href: '/report.html' }, // FR-15
  ],
};

function canSee(user, item) {
  if (!item.permission) return true;
  return user?.role === 'admin' || Boolean(user?.permissions.includes(item.permission));
}

export async function initLayout({ active } = {}) {
  const header = $('#site-header');
  const select = el('select', { id: 'viewing-as-select', 'aria-label': 'Viewing as' }, el('option', { value: '', text: 'Loading…' }));
  const nav = el('nav', { class: 'mainnav', id: 'mainnav', 'aria-label': 'Main' });
  const toggle = el(
    'button',
    { type: 'button', class: 'icon-btn nav-toggle', 'aria-expanded': 'false', 'aria-controls': 'mainnav', 'aria-label': 'Menu' },
    icon('menu'),
  );
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  // FR-25: the bell, shown once we know who is viewing.
  const bell = el(
    'a',
    { id: 'bell', class: 'icon-btn bell', href: '/notifications.html', 'aria-label': 'Notifications', 'aria-current': active === 'notifications' ? 'page' : null, hidden: true },
    icon('bell'),
    el('span', { class: 'bell__count', 'aria-hidden': 'true', hidden: true }),
  );

  replace(
    header,
    el(
      'div',
      { class: 'topbar' },
      el(
        'div',
        { class: 'topbar__inner' },
        toggle,
        el('a', { class: 'brand', href: '/' }, el('span', { class: 'brand__mark' }, icon('home')), el('span', { class: 'brand__name', text: BUILDING_NAME })),
        bell,
        el('label', { class: 'viewing-as' }, el('span', { class: 'viewing-as__label', text: 'Viewing as' }), select),
      ),
    ),
    nav,
  );

  const renderNav = (user) => {
    const items = (NAV[user?.role || 'none'] || []).filter((item) => canSee(user, item));
    replace(
      nav,
      el('ul', {}, items.map((item) => el('li', {}, el('a', { href: item.href, 'aria-current': item.key === active ? 'page' : null, text: item.label })))),
    );
  };

  // Resolve with the first user; when the user is switched later, reload the
  // page so everything (navigation, data, buttons) matches the new role.
  return new Promise((resolve, reject) => {
    let first = true;
    initViewingAs(select, (user) => {
      if (first) {
        first = false;
        renderNav(user);
        if (user) {
          bell.hidden = false;
          refreshBell();
          // Stay current while the page is open: check regularly while the tab is visible,
          // and at once when the person comes back to it (hidden tabs send nothing).
          setInterval(() => {
            if (document.visibilityState === 'visible') refreshBell();
          }, BELL_REFRESH_MS);
          document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') refreshBell();
          });
        }
        resolve(user);
      } else {
        location.reload();
      }
    }).catch((err) => {
      renderNav(null);
      reject(err);
    });
  });
}
