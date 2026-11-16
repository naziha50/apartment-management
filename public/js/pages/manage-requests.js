/**
 * "Manage requests" for the admin and staff (FR-18, FR-19, FR-20), with
 * filters, search and paging (FR-22). The server decides what each person
 * sees: the admin and staff with maintenance.view_all get every request,
 * other staff only the ones assigned to them.
 *
 * The chosen filters live in the page address (?status=…&q=…&page=…), so
 * refreshing, the back button and shared links keep them.
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { CATEGORY_LABELS, NEEDS_ACTION, PRIORITY_LABELS, STATUS_LABELS, categoryLabel, formatDate, priorityBadge, statusBadge } from '../format.js';
import { initLayout } from '../layout.js';
import { animateList, emptyState, errorState, pagination } from '../ui.js';

const card = $('#content');
const filterBox = $('#filters');

const seesAll = (user) => user.role === 'admin' || user.permissions.includes('maintenance.view_all');

// "Open" = everything still being worked on, the most useful view for the office.
const OPEN = 'submitted,under_review,in_progress,resolved';
const FILTER_KEYS = ['status', 'priority', 'category', 'assigned', 'q'];

/** The filter form; its field names match the API's query parameters. */
function filterForm(params, onChange) {
  const select = (name, label, options) =>
    el(
      'div',
      { class: 'field' },
      el('label', { for: `f-${name}`, text: label }),
      el(
        'select',
        { id: `f-${name}`, name },
        options.map(([value, text]) => el('option', { value, text, selected: params.get(name) === value || null })),
      ),
    );
  const form = el(
    'form',
    { class: 'filters', role: 'search', 'aria-label': 'Filter requests' },
    el('div', { class: 'field' }, el('label', { for: 'f-q', text: 'Search' }), el('input', { id: 'f-q', name: 'q', type: 'search', maxlength: 100, placeholder: 'Title or MR number', value: params.get('q') || '' })),
    select('status', 'Status', [['', 'Any status'], [OPEN, 'Open (not finished)'], [NEEDS_ACTION, 'Needs action'], ...Object.entries(STATUS_LABELS)]),
    select('priority', 'Priority', [['', 'Any priority'], ...Object.entries(PRIORITY_LABELS), ['unset', 'Not set yet']]),
    select('category', 'Category', [['', 'Any category'], ...Object.entries(CATEGORY_LABELS)]),
    select('assigned', 'Assigned', [['', 'Anyone'], ['none', 'Not assigned yet']]),
    el(
      'div',
      { class: 'form-actions' },
      el('button', { type: 'submit', class: 'btn btn-primary', text: 'Search' }),
      el('a', { class: 'btn btn-secondary', href: location.pathname, text: 'Clear' }),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    onChange(new FormData(form));
  });
  // Dropdowns apply at once; the search box waits for Enter or the button.
  form.addEventListener('change', (e) => {
    if (e.target.tagName === 'SELECT') onChange(new FormData(form));
  });
  return form;
}

function table(items) {
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
  animateList(rows);
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      { class: 'data', 'aria-label': 'Maintenance requests' },
      el('thead', {}, el('tr', {}, ['Request', 'Where', 'Status', 'Priority', 'Assigned to', 'Submitted'].map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, rows),
    ),
  );
}

/** Loads the page of requests that matches the address bar. */
async function load(all) {
  const params = new URLSearchParams(location.search);
  replace(card, el('p', { class: 'muted empty', text: 'Loading…' }));
  try {
    const data = await api.get(`/maintenance/requests?${params}`);
    const filtered = FILTER_KEYS.some((k) => params.get(k));
    if (!data.total) {
      replace(
        card,
        filtered
          ? emptyState('No requests match these filters.', 'Try another status or search word, or clear the filters.')
          : emptyState(all ? 'No requests yet.' : 'Nothing is assigned to you yet.', all ? 'New requests from residents will appear here.' : 'Requests the admin assigns to you will appear here.'),
      );
      return;
    }
    replace(
      card,
      el('p', { class: 'list-summary muted small', role: 'status', text: `${data.total} request${data.total === 1 ? '' : 's'}${filtered ? (data.total === 1 ? ' matches' : ' match') : ''}` }),
      table(data.items),
      pagination(data, (page) => go({ ...Object.fromEntries(params), page })),
    );
  } catch (err) {
    replace(card, errorState(err, () => load(all)));
  }

  function go(next) {
    const clean = new URLSearchParams(Object.entries(next).filter(([, v]) => v !== '' && v != null));
    history.pushState(null, '', `${location.pathname}${clean.size ? `?${clean}` : ''}`);
    load(all);
    $('#main').focus();
  }
}

// Does this user see every request? Only changes wording; known once "Viewing as" has loaded.
let all = true;

const showFilters = () =>
  replace(
    filterBox,
    filterForm(new URLSearchParams(location.search), (data) => {
      // A new filter starts again from page 1.
      const clean = new URLSearchParams([...data].filter(([, v]) => v !== ''));
      history.pushState(null, '', `${location.pathname}${clean.size ? `?${clean}` : ''}`);
      load(all);
    }),
  );

// The filter bar does not depend on who is viewing, so draw it at once: showing it
// later would push the list down while the page loads (layout shift).
showFilters();
filterBox.hidden = false;

try {
  const user = await initLayout({ active: 'requests' });
  card.hidden = false; // everything below renders into it
  if (!user || user.role === 'resident') {
    filterBox.hidden = true;
    replace(card, emptyState('This page is for staff and the admin.', 'Choose a staff member or the admin in the “Viewing as” menu.'));
  } else {
    all = seesAll(user);
    $('#page-title').textContent = all ? 'Maintenance requests' : 'My tasks';
    $('#page-hint').textContent = all ? 'Every request in the building, most recently updated first.' : 'Requests assigned to you, most recently updated first.';
    // Back / forward: show the filters and results that belong to that address.
    window.addEventListener('popstate', () => {
      showFilters();
      load(all);
    });
    await load(all);
  }
} catch (err) {
  card.hidden = false;
  replace(card, errorState(err, () => location.reload()));
}
