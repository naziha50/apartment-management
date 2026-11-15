/**
 * FR-21: "My requests" — the resident's requests, most recently updated first.
 * On phones the table turns into stacked cards (UI-03).
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { categoryLabel, formatDate, statusBadge } from '../format.js';
import { initLayout } from '../layout.js';
import { animateList, emptyState, errorState } from '../ui.js';

const card = $('#content');

try {
  const user = await initLayout({ active: 'requests' });
  if (user?.role !== 'resident') {
    replace(card, emptyState('This page is for residents.', 'Choose a resident in the “Viewing as” menu to see their requests.'));
  } else {
    const { items } = await api.get('/maintenance/requests');
    if (!items.length) {
      replace(
        card,
        emptyState(
          'You have not reported any problems yet.',
          'When something needs fixing, report it and follow its progress here.',
          el('a', { class: 'btn btn-primary', href: '/resident/new-request.html', text: 'Report a problem' }),
        ),
      );
    } else {
      const rows = items.map((r) =>
        el(
          'tr',
          {},
          el(
            'td',
            { class: 'cell-title', 'data-label': 'Request' },
            el('a', { href: `/request.html?id=${r.id}`, text: r.title }),
            el('div', { class: 'muted small', text: r.requestNumber }),
          ),
          el('td', { 'data-label': 'Category', text: categoryLabel(r.category) }),
          el('td', { 'data-label': 'Status' }, statusBadge(r.status)),
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
            { class: 'data', 'aria-label': 'My maintenance requests' },
            el('thead', {}, el('tr', {}, ['Request', 'Category', 'Status', 'Submitted'].map((h) => el('th', { scope: 'col', text: h })))),
            el('tbody', {}, rows),
          ),
        ),
      );
      animateList(rows);
    }
  }
} catch (err) {
  replace(card, errorState(err, () => location.reload()));
}
