/**
 * The frame every page shares (UI-02): top bar with the building name and the
 * "Viewing as" menu, and a navigation bar that shows only the links for the
 * current user's role (FR-02). On phones the navigation folds into a menu
 * button (UI-03).
 *
 *   const user = await initLayout({ active: 'home' });   // user may be null
 */
import { el, $, icon, replace } from './dom.js';
import { initViewingAs } from './viewing-as.js';

const BUILDING_NAME = 'Green Valley Apartments';

/**
 * Navigation per role. Each later step adds the links for the pages it builds,
 * e.g. { key: 'myRequests', label: 'My requests', href: '/resident/requests.html' }.
 * `permission` hides a link from staff who were not granted it (Appendix B).
 */
const NAV = {
  none: [{ key: 'home', label: 'Home', href: '/' }],
  resident: [{ key: 'home', label: 'Home', href: '/' }],
  staff: [{ key: 'home', label: 'Home', href: '/' }],
  admin: [{ key: 'home', label: 'Home', href: '/' }],
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
