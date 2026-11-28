/**
 * Apartments, for the admin: add units, assign residents as owner or tenant,
 * record move-outs and look at a unit's history.
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { formatDate } from '../format.js';
import { initLayout } from '../layout.js';
import { animateList, emptyState, errorState, showFieldErrors, toast, withBusy } from '../ui.js';

const panel = $('#panel');
const content = $('#content');
const TYPE_LABEL = { owner: 'Owner', tenant: 'Tenant' };

let today = ''; // from the server, so the browser's own date never matters

const field = (name, label, control) => el('div', { class: 'field' }, el('label', { for: `a-${name}`, text: label }), control);
const input = (name, label, attrs) => field(name, label, el('input', { id: `a-${name}`, name, ...attrs }));
const select = (name, label, options) =>
  field(name, label, el('select', { id: `a-${name}`, name }, options.map(([value, text]) => el('option', { value, text }))));

/** A form that posts its fields to `path`, then goes back to "Add an apartment". */
function postForm({ fields, path, action, done }) {
  const form = el('form', { class: 'grid grid-2', novalidate: true }, fields);
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: action });
  const cancel = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: () => showAdd() });
  form.append(el('div', { class: 'form-actions' }, submit, path === '/units' ? null : cancel));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    await withBusy(
      submit,
      async () => {
        try {
          const { unit } = await api.post(path, Object.fromEntries(new FormData(form)));
          toast(done(unit), 'ok');
          showAdd();
          await load();
        } catch (err) {
          showFieldErrors(form, err.fields, err.message);
        }
      },
      'Saving…',
    );
  });
  return form;
}

/** Fills the top card and, for a row action, moves the keyboard there. */
function showPanel(title, body, focus = true) {
  replace(panel, el('h2', { id: 'panel-title', tabindex: '-1', text: title }), body);
  if (!focus) return;
  panel.scrollIntoView({ block: 'start' });
  $('#panel-title').focus();
}

function showAdd() {
  showPanel(
    'Add an apartment',
    postForm({
      path: '/units',
      action: 'Add apartment',
      done: (unit) => `Apartment ${unit.unitNumber} added.`,
      fields: [
        input('unitNumber', 'Apartment number', { type: 'text', maxlength: 10, placeholder: 'e.g. 4B' }),
        input('floor', 'Floor', { type: 'number', min: 0, max: 100 }),
        input('sizeSqft', 'Size in sq ft (optional)', { type: 'number', min: 1 }),
        input('bedrooms', 'Bedrooms (optional)', { type: 'number', min: 0, max: 20 }),
      ],
    }),
    false,
  );
}

async function showAssign(unit) {
  try {
    const { items } = await api.get('/units/residents');
    showPanel(
      `Assign a resident to ${unit.unitNumber}`,
      postForm({
        path: `/units/${unit.id}/occupancies`,
        action: 'Assign',
        done: () => `Resident assigned to ${unit.unitNumber}.`,
        fields: [
          select('residentId', 'Resident', [['', 'Choose a resident'], ...items.map((r) => [String(r.id), r.fullName])]),
          select('type', 'Owner or tenant', [['', 'Choose one'], ...Object.entries(TYPE_LABEL)]),
          input('startDate', 'Move-in date', { type: 'date', max: today, value: today }),
        ],
      }),
    );
  } catch (err) {
    toast(err.message, 'error');
  }
}

function showMoveOut(unit, stay) {
  showPanel(
    `Move ${stay.fullName} out of ${unit.unitNumber}`,
    postForm({
      path: `/units/occupancies/${stay.id}/move-out`,
      action: 'Record move-out',
      done: () => `Move-out recorded for ${stay.fullName}.`,
      fields: [input('endDate', 'Last day living there', { type: 'date', min: stay.startDate, max: today, value: today })],
    }),
  );
}

async function showHistory(unit) {
  try {
    const { unit: full } = await api.get(`/units/${unit.id}`);
    const items = full.history.map((s) =>
      el('li', { text: `${s.fullName} (${TYPE_LABEL[s.type]}): ${formatDate(s.startDate)} to ${s.endDate ? formatDate(s.endDate) : 'now'}` }),
    );
    showPanel(
      `History of ${unit.unitNumber}`,
      el(
        'div',
        { class: 'form' },
        items.length ? el('ul', {}, items) : el('p', { class: 'muted', text: 'Nobody has lived here yet.' }),
        el('div', { class: 'form-actions' }, el('button', { type: 'button', class: 'btn btn-secondary', text: 'Close', onclick: () => showAdd() })),
      ),
    );
  } catch (err) {
    toast(err.message, 'error');
  }
}

function residentLine(unit, stay) {
  const ends = stay.endDate ? ` · until ${formatDate(stay.endDate)}` : '';
  return el(
    'div',
    { class: 'row' },
    el(
      'div',
      {},
      el('div', { text: `${stay.fullName}${stay.residentActive ? '' : ' (inactive)'}` }),
      el('div', { class: 'muted small', text: `${TYPE_LABEL[stay.type]} since ${formatDate(stay.startDate)}${ends}` }),
    ),
    stay.endDate
      ? null
      : el('button', { type: 'button', class: 'btn btn-secondary', text: 'Move out', 'aria-label': `Move ${stay.fullName} out of ${unit.unitNumber}`, onclick: () => showMoveOut(unit, stay) }),
  );
}

function table(units) {
  const rows = units.map((u) => {
    const [kind, label] = u.unavailable
      ? ['status-rejected', 'Unavailable']
      : u.residents.length ? ['status-resolved', 'Occupied'] : ['status-cancelled', 'Vacant'];
    const details = [`Floor ${u.floor ?? '—'}`, u.sizeSqft && `${u.sizeSqft} sq ft`, u.bedrooms != null && `${u.bedrooms} bed`].filter(Boolean).join(' · ');
    return el(
      'tr',
      {},
      el('td', { class: 'cell-title', 'data-label': 'Apartment' }, el('strong', { text: u.unitNumber }), el('div', { class: 'muted small', text: details })),
      el('td', { 'data-label': 'Status' }, el('span', { class: `badge ${kind}`, text: label })),
      el('td', { 'data-label': 'Residents' }, u.residents.length ? el('div', { class: 'form' }, u.residents.map((s) => residentLine(u, s))) : 'None'),
      el(
        'td',
        { 'data-label': 'Actions' },
        el(
          'div',
          { class: 'row' },
          u.unavailable ? null : el('button', { type: 'button', class: 'btn btn-secondary', text: 'Assign', 'aria-label': `Assign a resident to ${u.unitNumber}`, onclick: () => showAssign(u) }),
          el('button', { type: 'button', class: 'btn btn-secondary', text: 'History', 'aria-label': `History of ${u.unitNumber}`, onclick: () => showHistory(u) }),
        ),
      ),
    );
  });
  animateList(rows);
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      { class: 'data', 'aria-label': 'Apartments' },
      el('thead', {}, el('tr', {}, ['Apartment', 'Status', 'Residents', 'Actions'].map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, rows),
    ),
  );
}

async function load() {
  try {
    const data = await api.get('/units');
    today = data.today;
    replace(content, data.items.length ? table(data.items) : emptyState('No apartments yet.', 'Add the first one above.'));
  } catch (err) {
    replace(content, errorState(err, load));
  }
}

try {
  const user = await initLayout({ active: 'apartments' });
  if (user?.role !== 'admin') {
    panel.hidden = true;
    replace(content, emptyState('This page is for the admin.', 'Choose the admin in the “Viewing as” menu.'));
  } else {
    showAdd();
    await load();
  }
} catch (err) {
  replace(content, errorState(err, () => location.reload()));
}
