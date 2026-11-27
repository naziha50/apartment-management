/**
 * Maintenance report (FR-22, FR-50) for the admin and staff with reports.view:
 * how many requests came in, how fast they were resolved, which apartments and
 * categories have the most, and how residents rated the work.
 *
 * The period lives in the page address (?from=…&to=…), so refreshing and shared links keep it.
 * Every figure is a table, which reads well aloud and prints (NFR-12).
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { STATUS_LABELS, categoryLabel, formatDate } from '../format.js';
import { initLayout } from '../layout.js';
import { animateIn, countUp, dateRangeOk, emptyState, errorState } from '../ui.js';

const content = $('#content');
const periodBox = $('#period');

/** 5 → "5 hours", 50 → "2.1 days"; null when nothing was resolved. */
function duration(hours) {
  if (hours == null) return '—';
  if (hours < 48) return `${hours} hour${hours === 1 ? '' : 's'}`;
  return `${(hours / 24).toFixed(1)} days`;
}

const rating = (avg, count) => (avg == null ? '—' : `${avg.toFixed(2)} ★ (${count})`);

/** A table that becomes stacked cards on phones, like the request lists. */
function table(caption, headers, rows) {
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      { class: 'data' },
      el('caption', { class: 'visually-hidden', text: caption }),
      el('thead', {}, el('tr', {}, headers.map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, rows.map((cells) => el('tr', {}, cells.map((c, i) => el('td', { 'data-label': headers[i], text: String(c) }))))),
    ),
  );
}

const card = (title, ...children) => el('section', { class: 'card card--flush report-card' }, el('h2', { text: title }), ...children);

function periodForm() {
  const params = new URLSearchParams(location.search);
  const date = (name, label) =>
    el('div', { class: 'field' }, el('label', { for: `p-${name}`, text: label }), el('input', { id: `p-${name}`, name, type: 'date', value: params.get(name) || '' }));
  const form = el(
    'form',
    { class: 'filters', 'aria-label': 'Report period' },
    date('from', 'From'),
    date('to', 'Until'),
    el(
      'div',
      { class: 'form-actions' },
      el('button', { type: 'submit', class: 'btn btn-primary', text: 'Show report' }),
      el('a', { class: 'btn btn-secondary', href: location.pathname, text: 'All time' }),
    ),
  );
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!dateRangeOk(form)) return;
    const clean = new URLSearchParams([...new FormData(form)].filter(([, v]) => v !== ''));
    history.pushState(null, '', `${location.pathname}${clean.size ? `?${clean}` : ''}`);
    load();
  });
  replace(periodBox, form);
}

function render(r) {
  const o = r.overall;
  const period = r.from || r.to ? `${r.from ? formatDate(r.from) : 'the start'} – ${r.to ? formatDate(r.to) : 'today'}` : 'All time';
  if (!o.requests) {
    replace(content, el('section', { class: 'card' }, emptyState(`No requests in this period (${period}).`, 'Choose a longer period, or “All time”.')));
    return;
  }
  const stat = (value, label) => {
    const v = el('span', { class: 'stat__value', text: typeof value === 'number' ? '0' : value });
    if (typeof value === 'number') countUp(v, value);
    return el('div', { class: 'stat' }, v, el('span', { class: 'stat__label', text: label }));
  };
  const figures = (x) => [x.requests, x.resolved, duration(x.avgHoursToResolve), rating(x.avgRating, x.ratings)];

  replace(
    content,
    el(
      'section',
      { class: 'card', 'aria-labelledby': 'summary-title' },
      el('h2', { id: 'summary-title', text: `Summary · ${period}` }),
      el(
        'div',
        { class: 'stats' },
        stat(o.requests, 'Requests submitted'),
        stat(o.resolved, 'Resolved so far'),
        stat(duration(o.avgHoursToResolve), 'Average time to resolve'),
        stat(o.avgRating == null ? '—' : `${o.avgRating.toFixed(2)} ★`, `Average rating (${o.ratings} rating${o.ratings === 1 ? '' : 's'})`),
      ),
    ),
    card('By status', table('Requests by status', ['Status', 'Requests'], Object.keys(STATUS_LABELS).filter((s) => r.byStatus[s]).map((s) => [STATUS_LABELS[s], r.byStatus[s]]))),
    card(
      'By category',
      table('Requests by category, busiest first', ['Category', 'Requests', 'Resolved', 'Average time to resolve', 'Average rating'], r.byCategory.map((c) => [categoryLabel(c.category), ...figures(c)])),
    ),
    card(
      'Apartments with the most requests',
      r.topUnits.length
        ? table('Top five apartments by requests inside the apartment', ['Apartment', 'Requests'], r.topUnits.map((u) => [`Apt ${u.unitNumber}`, u.requests]))
        : el('p', { class: 'muted empty', text: 'Only common-area problems in this period.' }),
      el('p', { class: 'muted small report-note', text: 'Problems inside the apartment only; common-area reports are not counted for an apartment.' }),
    ),
    card(
      'By staff member',
      r.byStaff.length
        ? table('Requests by assigned staff member', ['Staff member', 'Assigned', 'Resolved', 'Average time to resolve', 'Average rating'], r.byStaff.map((s) => [s.fullName, ...figures(s)]))
        : el('p', { class: 'muted empty', text: 'No requests were assigned in this period.' }),
    ),
  );
  animateIn(content);
}

async function load() {
  try {
    render(await api.get(`/maintenance/report${location.search}`));
  } catch (err) {
    replace(content, el('section', { class: 'card' }, errorState(err, load)));
  }
}

periodForm();
try {
  const user = await initLayout({ active: 'report' });
  if (!user || !(user.role === 'admin' || user.permissions.includes('reports.view'))) {
    periodBox.hidden = true;
    replace(content, el('section', { class: 'card' }, emptyState('This report is for the admin.', 'Choose the admin in the “Viewing as” menu, or ask the admin for the reports permission.')));
  } else {
    window.addEventListener('popstate', () => {
      periodForm();
      load();
    });
    await load();
  }
} catch (err) {
  replace(content, el('section', { class: 'card' }, errorState(err, () => location.reload())));
}
