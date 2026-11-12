/**
 * "Viewing as" menu: choose which demo user you are acting as.
 * DEVELOPMENT STAND-IN FOR LOGIN — not authentication.
 *
 * User data is always inserted with textContent, never innerHTML, so names
 * cannot inject script (NFR-05).
 */
import { api, getViewingAs, setViewingAs } from './api.js';

const ROLE_LABEL = { admin: 'Admin', staff: 'Staff', resident: 'Resident' };

/**
 * Fills the <select> with all users, grouped by role, and keeps the choice.
 * `onChange(user)` runs with the current user (or null) on load and on every change.
 */
export async function initViewingAs(select, onChange) {
  const { items } = await api.get('/dev/users');

  select.replaceChildren(new Option('Choose a user…', ''));
  for (const role of ['admin', 'staff', 'resident']) {
    const group = document.createElement('optgroup');
    group.label = ROLE_LABEL[role];
    for (const u of items.filter((x) => x.role === role)) {
      group.append(new Option(u.fullName, String(u.id)));
    }
    if (group.children.length) select.append(group);
  }

  // Forget a saved choice that no longer exists (e.g. after npm run db:reset).
  const saved = getViewingAs();
  if (saved && !items.some((u) => String(u.id) === saved)) setViewingAs(null);
  select.value = getViewingAs() || '';

  const report = async () => {
    if (!select.value) return onChange(null);
    try {
      const { user } = await api.get('/me');
      onChange(user);
    } catch {
      setViewingAs(null);
      select.value = '';
      onChange(null);
    }
  };

  select.addEventListener('change', () => {
    setViewingAs(select.value || null);
    report();
  });
  await report();
}
