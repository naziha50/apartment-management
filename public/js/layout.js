/**
 * The frame every page shares (UI-02): top bar with the building name, the
 * logged-in user's name and a Log out button (FR-01), and a navigation bar that
 * shows only the links for the user's role (FR-02). On phones the navigation
 * folds into a menu button (UI-03).
 *
 * Every page needs a login (NFR-03): without one, the browser goes to the
 * login page, which brings the person back here afterwards.
 *
 *   const user = await initLayout({ active: 'home' });
 */
import { api } from './api.js';
import { el, $, icon, replace } from './dom.js';
import { toast } from './ui.js';

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
    // Marked as background: this automatic check must not keep an unattended session alive (NFR-03).
    const { unread } = await api.get('/notifications/unread-count', { 'X-Background': '1' });
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
    { key: 'announcements', label: 'Announcements', href: '/announcements.html' }, // FR-23
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
    { key: 'announcements', label: 'Announcements', href: '/announcements.html' }, // FR-23
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
  // FR-01: who is logged in, and the way out.
  const accountName = el('span', { class: 'account__name' });
  const logout = el('button', { type: 'button', class: 'account__logout', text: 'Log out' });
  logout.addEventListener('click', async () => {
    logout.disabled = true;
    try {
      await api.post('/auth/logout');
    } finally {
      location.href = '/login.html';
    }
  });
  const account = el('div', { class: 'account', hidden: true }, accountName, logout);
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
        account,
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

  // Who is logged in? Without a login, api.js has already sent the browser to the
  // login page, so this page never finishes loading (the promise never resolves).
  let user;
  try {
    ({ user } = await api.get('/me'));
  } catch (err) {
    if (err.status === 401) return new Promise(() => {});
    renderNav(null);
    throw err;
  }

  renderNav(user);
  accountName.textContent = user.fullName;
  account.hidden = false;
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
  return user;
}
