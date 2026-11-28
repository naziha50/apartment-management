/**
 * Resident accounts, for the admin: add, search, edit, deactivate and
 * reactivate. The search is kept in the address (?q=&status=&page=).
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { initLayout } from '../layout.js';
import { animateList, emptyState, errorState, pagination, showFieldErrors, toast, withBusy } from '../ui.js';

const editorBox = $('#editor');
const content = $('#content');
const searchForm = $('#search-form');

const field = (name, label, attrs) =>
  el('div', { class: 'field' }, el('label', { for: `r-${name}`, text: label }), el('input', { id: `r-${name}`, name, required: true, ...attrs }));

/** The add / edit form. `resident` is null for a new one. */
function editor(resident) {
  const form = el(
    'form',
    { class: 'grid grid-2', novalidate: true },
    field('fullName', 'Full name', { type: 'text', maxlength: 100, value: resident?.fullName || '' }),
    field('email', 'Email', { type: 'email', maxlength: 150, value: resident?.email || '' }),
    field('phone', 'Mobile number', { type: 'tel', maxlength: 20, value: resident?.phone || '', placeholder: '01712345678' }),
  );
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: resident ? 'Save changes' : 'Add resident' });
  form.append(
    el(
      'div',
      { class: 'form-actions' },
      submit,
      resident ? el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: () => showEditor(null) }) : null,
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    await withBusy(
      submit,
      async () => {
        try {
          const { resident: saved } = resident ? await api.patch(`/residents/${resident.id}`, body) : await api.post('/residents', body);
          toast(resident ? `${saved.fullName} saved.` : `${saved.fullName} added.`, 'ok');
          showEditor(null);
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

function showEditor(resident) {
  replace(editorBox, el('h2', { id: 'editor-title', text: resident ? `Edit ${resident.fullName}` : 'Add a resident' }), editor(resident));
  if (resident) {
    editorBox.scrollIntoView({ block: 'start' });
    $('#r-fullName').focus();
  }
}

async function setActive(resident, active, button) {
  await withBusy(
    button,
    async () => {
      try {
        await api.post(`/residents/${resident.id}/${active ? 'reactivate' : 'deactivate'}`);
        toast(`${resident.fullName} is now ${active ? 'active' : 'inactive'}.`, 'ok');
        await load();
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    'Saving…',
  );
}

function table(items) {
  const rows = items.map((r) => {
    const edit = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Edit', 'aria-label': `Edit ${r.fullName}`, onclick: () => showEditor(r) });
    const verb = r.active ? 'Deactivate' : 'Reactivate';
    const toggle = el('button', { type: 'button', class: 'btn btn-secondary', text: verb, 'aria-label': `${verb} ${r.fullName}` });
    toggle.addEventListener('click', () => {
      if (r.active && !window.confirm(`Deactivate ${r.fullName}? You can reactivate the account later.`)) return;
      setActive(r, !r.active, toggle);
    });
    return el(
      'tr',
      {},
      el('td', { class: 'cell-title', 'data-label': 'Name' }, el('strong', { text: r.fullName })),
      el('td', { 'data-label': 'Contact' }, el('div', { text: r.email || '—' }), el('div', { class: 'muted small', text: r.phone || '—' })),
      el('td', { 'data-label': 'Units', text: r.units.join(', ') || 'None' }),
      el('td', { 'data-label': 'Status' }, el('span', { class: `badge ${r.active ? 'status-resolved' : 'status-cancelled'}`, text: r.active ? 'Active' : 'Inactive' })),
      el('td', { 'data-label': 'Actions' }, el('div', { class: 'row' }, edit, toggle)),
    );
  });
  animateList(rows);
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      { class: 'data', 'aria-label': 'Residents' },
      el('thead', {}, el('tr', {}, ['Name', 'Contact', 'Units', 'Status', 'Actions'].map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, rows),
    ),
  );
}

/** Puts the search in the address and shows the matching page. */
function go(params) {
  const query = new URLSearchParams([...params].filter(([, value]) => value)).toString();
  history.pushState(null, '', query ? `?${query}` : location.pathname);
  load();
}

async function load() {
  const params = new URLSearchParams(location.search);
  searchForm.elements.q.value = params.get('q') || '';
  searchForm.elements.status.value = params.get('status') || '';
  try {
    const data = await api.get(`/residents?${params}`);
    replace(
      content,
      data.items.length ? table(data.items) : emptyState('No residents found.', 'Try a different search, or add a resident above.'),
      pagination(data, (page) => {
        params.set('page', page);
        go(params);
      }),
    );
  } catch (err) {
    replace(content, errorState(err, load));
  }
}

try {
  const user = await initLayout({ active: 'residents' });
  if (user?.role !== 'admin') {
    editorBox.hidden = true;
    replace(content, emptyState('This page is for the admin.', 'Choose the admin in the “Viewing as” menu.'));
  } else {
    showEditor(null);
    $('#filters').hidden = false;
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      go(new URLSearchParams(new FormData(searchForm)));
    });
    window.addEventListener('popstate', load);
    await load();
  }
} catch (err) {
  replace(content, errorState(err, () => location.reload()));
}
