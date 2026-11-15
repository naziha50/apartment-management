/**
 * "Manage requests" for the admin and staff (FR-18, FR-19, FR-20).
 * The server decides what each person sees: the admin and staff with
 * maintenance.view_all get every request, other staff only the ones assigned to them.
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { categoryLabel, formatDate, priorityBadge, statusBadge } from '../format.js';
import { initLayout } from '../layout.js';
import { animateList, emptyState, errorState } from '../ui.js';

const card = $('#content');

const seesAll = (user) => user.role === 'admin' || user.permissions.includes('maintenance.view_all');

function render(items) {
  const rows = items.map((r) =>
    el(
      'tr',
      {},
      el(
        'td',
        { class: 'cell-title', 'data-label': 'Request' },
        el('a', { href: `/request.html?id=${r.id}`, text: r.title }),
        el('div', { class: 'muted small', text: `${r.requestNumber} · ${categoryLabel(r.category)}` }),
      ),
      // The reporter's apartment is always stored (FR-17), so check the location first.
      el('td', { 'data-label': 'Where', text: r.location === 'common_area' || !r.unit ? 'Common area' : `Apt ${r.unit.unitNumber}` }),
      el('td', { 'data-label': 'Status' }, statusBadge(r.status)),
      el('td', { 'data-label': 'Priority' }, priorityBadge(r.priority)),
      el('td', { 'data-label': 'Assigned to', text: r.assignedTo?.fullName || '—' }),
      el('td', { 'data-label': 'Submitted', text: formatDate(r.submittedAt) }),
    ),
  );
  replace(
    card,
    el(
      'div',
      { class: 'table-wrap' },
      el(
        'table',
        { class: 'data', 'aria-label': 'Maintenance requests' },
        el('thead', {}, el('tr', {}, ['Request', 'Where', 'Status', 'Priority', 'Assigned to', 'Submitted'].map((h) => el('th', { scope: 'col', text: h })))),
        el('tbody', {}, rows),
      ),
    ),
  );
  animateList(rows);
}

try {
  const user = await initLayout({ active: 'requests' });
  if (!user || user.role === 'resident') {
    replace(card, emptyState('This page is for staff and the admin.', 'Choose a staff member or the admin in the “Viewing as” menu.'));
  } else {
    const all = seesAll(user);
    $('#page-title').textContent = all ? 'Maintenance requests' : 'My tasks';
    $('#page-hint').textContent = all ? 'Every request in the building, most recently updated first.' : 'Requests assigned to you, most recently updated first.';

    const { items } = await api.get('/maintenance/requests');
    if (!items.length) {
      replace(card, emptyState(all ? 'No requests yet.' : 'Nothing is assigned to you yet.', all ? 'New requests from residents will appear here.' : 'Requests the admin assigns to you will appear here.'));
    } else {
      render(items);
    }
  }
} catch (err) {
  replace(card, errorState(err, () => location.reload()));
}
