/**
 * Scheduled maintenance tasks (FR-49, BR-25) for the admin and staff with
 * maintenance.assign: add and edit recurring jobs, pause and resume them, and
 * see what is due in the next 90 days. The server creates each job's request
 * 7 days before its due date.
 *
 * Due dates are Bangladesh calendar days, sent and shown as YYYY-MM-DD from the API.
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { CATEGORY_LABELS, categoryLabel } from '../format.js';
import { initLayout } from '../layout.js';
import { animateList, emptyState, errorState, showFieldErrors, toast, withBusy } from '../ui.js';

const editorBox = $('#editor');
const content = $('#content');

// Calendar days from the API ('2026-12-16'); formatted as UTC so the day never shifts.
const DAY = new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeZone: 'UTC' });
const dayText = (ymd) => DAY.format(new Date(`${ymd}T00:00:00Z`));
const todayInDhaka = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Dhaka' });
const every = (months) => (months === 1 ? 'Every month' : `Every ${months} months`);

let staff = [];

// The hint goes under the control, so every control in a row starts at the same height.
const field = (id, label, control, hint) =>
  el('div', { class: 'field' }, el('label', { for: id, text: label }), control, hint ? el('p', { class: 'hint', id: `${id}-hint`, text: hint }) : null);

const select = (id, name, options, value) =>
  el('select', { id, name }, options.map(([v, text]) => el('option', { value: v, text, selected: String(value ?? '') === v || null })));

/** The add / edit form. `task` is null for a new task. */
function editor(task) {
  const form = el(
    'form',
    { class: 'grid grid-2 task-form', novalidate: true },
    field('t-title', 'Title', el('input', { id: 't-title', name: 'title', type: 'text', required: true, maxlength: 120, value: task?.title || '', placeholder: 'e.g. Lift servicing' })),
    field('t-category', 'Category', select('t-category', 'category', [['', 'Choose a category'], ...Object.entries(CATEGORY_LABELS)], task?.category)),
    field('t-interval', 'Repeats', select('t-interval', 'intervalMonths', Array.from({ length: 24 }, (_, i) => [String(i + 1), every(i + 1)]), task?.intervalMonths ?? 1)),
    field(
      't-due',
      'Next due date',
      el('input', { id: 't-due', name: 'nextDueDate', type: 'date', required: true, min: todayInDhaka(), value: task?.nextDueDate || '', 'aria-describedby': 't-due-hint' }),
      'The request is created 7 days before this date.',
    ),
    field(
      't-assignee',
      'Assign to',
      select('t-assignee', 'defaultAssigneeId', [['', 'Nobody (the office assigns it)'], ...staff.map((s) => [String(s.id), s.fullName])], task?.defaultAssignee?.id),
    ),
    field('t-description', 'Description (optional)', el('textarea', { id: 't-description', name: 'description', maxlength: 4000, rows: 3, text: task?.description || '' })),
  );
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: task ? 'Save changes' : 'Add task' });
  form.append(
    el(
      'div',
      { class: 'form-actions' },
      submit,
      task ? el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: () => showEditor(null) }) : null,
    ),
  );

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    body.intervalMonths = Number(body.intervalMonths);
    body.defaultAssigneeId = body.defaultAssigneeId ? Number(body.defaultAssigneeId) : null;
    await withBusy(
      submit,
      async () => {
        try {
          const saved = task
            ? await api.patch(`/maintenance/scheduled-tasks/${task.id}`, body)
            : await api.post('/maintenance/scheduled-tasks', body);
          toast(task ? `“${saved.title}” saved.` : `“${saved.title}” added. Its request is created on ${dayText(saved.createsRequestOn)}.`, 'ok');
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

function showEditor(task) {
  replace(editorBox, el('h2', { id: 'editor-title', text: task ? `Edit “${task.title}”` : 'Add a scheduled task' }), editor(task));
  if (task) {
    editorBox.scrollIntoView({ block: 'start' });
    $('#t-title').focus();
  }
}

async function setPaused(task, paused, button) {
  await withBusy(
    button,
    async () => {
      try {
        await api.patch(`/maintenance/scheduled-tasks/${task.id}`, { paused });
        toast(paused ? `“${task.title}” is paused. It creates no requests until resumed.` : `“${task.title}” is active again.`, 'ok');
        await load();
      } catch (err) {
        toast(err.message, 'error');
      }
    },
    paused ? 'Pausing…' : 'Resuming…',
  );
}

function table(items) {
  const rows = items.map((t) => {
    const pause = el('button', { type: 'button', class: 'btn btn-secondary', text: t.paused ? 'Resume' : 'Pause', 'aria-label': `${t.paused ? 'Resume' : 'Pause'} ${t.title}` });
    pause.addEventListener('click', () => setPaused(t, !t.paused, pause));
    const edit = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Edit', 'aria-label': `Edit ${t.title}`, onclick: () => showEditor(t) });
    const assignee = t.defaultAssignee ? `${t.defaultAssignee.fullName}${t.defaultAssignee.active ? '' : ' (inactive)'}` : 'The office assigns it';
    return el(
      'tr',
      {},
      el(
        'td',
        { class: 'cell-title', 'data-label': 'Task' },
        el('strong', { text: t.title }),
        el('div', { class: 'muted small', text: `${categoryLabel(t.category)} · ${every(t.intervalMonths)}` }),
      ),
      el('td', { 'data-label': 'Next due', text: dayText(t.nextDueDate) }),
      el('td', { 'data-label': 'Request created', text: t.paused ? '— (paused)' : dayText(t.createsRequestOn) }),
      el('td', { 'data-label': 'Assigned to', text: assignee }),
      el('td', { 'data-label': 'Status' }, el('span', { class: `badge ${t.paused ? 'status-cancelled' : 'status-resolved'}`, text: t.paused ? 'Paused' : 'Active' })),
      el('td', { 'data-label': 'Actions' }, el('div', { class: 'row' }, edit, pause)),
    );
  });
  animateList(rows);
  return el(
    'div',
    { class: 'table-wrap' },
    el(
      'table',
      { class: 'data', 'aria-label': 'Scheduled tasks' },
      el('thead', {}, el('tr', {}, ['Task', 'Next due', 'Request created', 'Assigned to', 'Status', 'Actions'].map((h) => el('th', { scope: 'col', text: h })))),
      el('tbody', {}, rows),
    ),
  );
}

/** "All tasks" or "Due in the next 90 days" (FR-49), kept in the address as ?due=90. */
function viewPicker(soon) {
  const picker = select('view', 'due', [['', 'All tasks'], ['90', 'Due in the next 90 days']], soon ? '90' : '');
  picker.addEventListener('change', () => {
    history.pushState(null, '', picker.value ? '?due=90' : location.pathname);
    load();
  });
  return el('div', { class: 'list-summary field field--inline' }, el('label', { for: 'view', text: 'Show' }), picker);
}

async function load() {
  const soon = new URLSearchParams(location.search).get('due') === '90';
  try {
    const { items } = await api.get(`/maintenance/scheduled-tasks${soon ? '?dueWithinDays=90' : ''}`);
    replace(
      content,
      viewPicker(soon),
      items.length
        ? table(items)
        : emptyState(
            soon ? 'Nothing is due in the next 90 days.' : 'No scheduled tasks yet.',
            soon ? 'Paused tasks are not listed here.' : 'Add recurring jobs such as monthly lift servicing above.',
          ),
    );
  } catch (err) {
    replace(content, errorState(err, load));
  }
}

try {
  const user = await initLayout({ active: 'tasks' });
  if (!user || !(user.role === 'admin' || user.permissions.includes('maintenance.assign'))) {
    editorBox.hidden = true;
    replace(content, emptyState('This page is for the admin.', 'Choose the admin in the “Viewing as” menu, or ask the admin for the “assign requests” permission.'));
  } else {
    ({ items: staff } = await api.get('/maintenance/staff'));
    showEditor(null);
    window.addEventListener('popstate', load);
    await load();
  }
} catch (err) {
  replace(content, errorState(err, () => location.reload()));
}
