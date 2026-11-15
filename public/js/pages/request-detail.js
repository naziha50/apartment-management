/**
 * FR-21: one maintenance request — its details and its history (FR-20).
 * Opened as /request.html?id=123. The server decides who may see it and
 * answers "not found" for anyone else (NFR-24).
 *
 * FR-18 / FR-20 / FR-35: the Actions card shows only the status moves the
 * server says this user may make now (`allowed.transitions`); the server checks
 * them again when one is posted.
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { LOCATION_LABELS, PRIORITY_LABELS, STATUS_LABELS, categoryLabel, formatDateTime, priorityBadge, statusBadge } from '../format.js';
import { initLayout } from '../layout.js';
import { animateIn, animateList, errorState, showFieldErrors, toast, withBusy } from '../ui.js';

const main = $('#main');
const params = new URLSearchParams(location.search);
let justSubmitted = Boolean(params.get('new')); // show the "submitted" message only on first load

/** Wording for each move. `danger` marks moves that cannot be undone. */
const ACTIONS = {
  under_review: { label: 'Start review', hint: 'Set how urgent this is. The resident will see that it is being reviewed.', submit: 'Start review' },
  rejected: { label: 'Reject', hint: 'Tell the resident why. This cannot be undone.', submit: 'Reject request', danger: true },
  in_progress: { label: 'Start work', hint: 'The resident will see that work has started.', submit: 'Start work' },
  resolved: { label: 'Mark as resolved', hint: 'Say what was done to fix it. The resident will be asked to confirm.', submit: 'Mark as resolved' },
  closed: { label: 'Yes, it is fixed', hint: 'This closes the request.', submit: 'Close request' },
  cancelled: { label: 'Cancel request', hint: 'Use this if the problem has gone away. This cannot be undone.', submit: 'Cancel request', danger: true },
  reopen: { label: 'It is not fixed', hint: 'Tell us what is still wrong. The request goes back to In progress.', submit: 'Reopen request' },
};

/** One move as a disclosure: the summary names it; inside are the fields it needs and a confirm button. */
function actionForm(r, user, t) {
  const a = ACTIONS[t.kind === 'reopen' ? 'reopen' : t.to];
  const key = t.kind || t.to;
  const fields = [];
  if (t.needs === 'priority') {
    fields.push(
      el(
        'div',
        { class: 'field' },
        el('label', { for: `${key}-priority`, text: 'Priority' }),
        el(
          'select',
          { id: `${key}-priority`, name: 'priority', required: true },
          el('option', { value: '', text: 'Choose a priority' }),
          ['high', 'medium', 'low'].map((p) => el('option', { value: p, text: PRIORITY_LABELS[p] })),
        ),
      ),
    );
  }
  if (t.needs === 'reason' || t.needs === 'note') {
    fields.push(
      el(
        'div',
        { class: 'field' },
        el('label', { for: `${key}-note`, text: t.needs === 'reason' ? 'Reason' : 'Note' }),
        el('textarea', { id: `${key}-note`, name: 'note', maxlength: 2000, required: true }),
      ),
    );
  }

  const button = el('button', { type: 'submit', class: a.danger ? 'btn btn-danger' : 'btn btn-primary', text: a.submit });
  const form = el('form', { class: 'form', novalidate: true }, el('p', { class: 'hint', text: a.hint }), fields, el('div', { class: 'form-actions' }, button));
  onSubmit(form, button, user, `/maintenance/requests/${r.id}/transition`, () => ({ to: t.to }), (u) => `Request ${u.requestNumber} is now ${STATUS_LABELS[u.status].toLowerCase()}.`);
  return el('details', { class: 'action' }, el('summary', { text: a.label }), form);
}

/** FR-19: pick an active staff member. The staff list is loaded the first time the item is opened. */
function assignForm(r, user) {
  const verb = r.assignedTo ? 'Reassign' : 'Assign to staff';
  const select = el('select', { id: 'assign-staff', name: 'staffId', required: true }, el('option', { value: '', text: 'Loading staff…' }));
  const button = el('button', { type: 'submit', class: 'btn btn-primary', text: r.assignedTo ? 'Reassign' : 'Assign' });
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    el('p', { class: 'hint', text: 'The staff member will see this request in their tasks.' }),
    el('div', { class: 'field' }, el('label', { for: 'assign-staff', text: 'Staff member' }), select),
    el('div', { class: 'form-actions' }, button),
  );
  const details = el('details', { class: 'action' }, el('summary', { text: verb }), form);

  let loaded = false;
  details.addEventListener('toggle', async () => {
    if (!details.open || loaded) return;
    loaded = true;
    try {
      const { items } = await api.get('/maintenance/staff');
      const others = items.filter((s) => s.id !== r.assignedTo?.id);
      replace(
        select,
        el('option', { value: '', text: others.length ? 'Choose a staff member' : 'No other active staff' }),
        others.map((s) => el('option', { value: String(s.id), text: s.fullName })),
      );
    } catch (err) {
      loaded = false;
      showFieldErrors(form, {}, err.message);
    }
  });
  onSubmit(form, button, user, `/maintenance/requests/${r.id}/assign`, () => ({}), (u) => `Request ${u.requestNumber} is now assigned to ${u.assignedTo.fullName}.`);
  return details;
}

/** FR-20: a progress note. Internal notes are kept from the resident. */
function noteForm(r, user) {
  const internal = el('input', { type: 'checkbox', id: 'note-internal' });
  const button = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Add note' });
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    el('p', { class: 'hint', text: 'Tell the resident how the work is going, or leave an internal note for staff.' }),
    el('div', { class: 'field' }, el('label', { for: 'note-text', text: 'Note' }), el('textarea', { id: 'note-text', name: 'note', maxlength: 2000, required: true })),
    el('label', { class: 'choice' }, internal, ' Internal note (only staff and the admin can see it)'),
    el('div', { class: 'form-actions' }, button),
  );
  onSubmit(form, button, user, `/maintenance/requests/${r.id}/notes`, () => ({ internal: internal.checked }), () => (internal.checked ? 'Internal note added.' : 'Note added.'));
  return el('details', { class: 'action' }, el('summary', { text: 'Add a note' }), form);
}

/**
 * Posts a form, then redraws the page with the request the server sends back.
 * Field errors appear next to their fields; anything else at the top of the form.
 */
function onSubmit(form, button, user, path, extra, message) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = { ...extra(), ...Object.fromEntries(new FormData(form)) };
    await withBusy(button, async () => {
      try {
        const updated = await api.post(path, body);
        justSubmitted = false;
        render(updated, user);
        main.focus(); // the clicked button is gone; keep keyboard users on the page
        toast(message(updated), 'ok');
      } catch (err) {
        showFieldErrors(form, err.fields, err.message);
      }
    });
  });
}

/** One line of history in plain words. */
function describe(u) {
  if (u.kind === 'status_change') {
    return u.fromStatus
      ? `Status changed from ${STATUS_LABELS[u.fromStatus]} to ${STATUS_LABELS[u.toStatus]}`
      : `Request ${STATUS_LABELS[u.toStatus].toLowerCase()}`;
  }
  if (u.kind === 'priority') return 'Priority changed';
  if (u.kind === 'assignment') return 'Staff assignment'; // the note says who
  return u.isInternal ? 'Internal note (staff only)' : 'Note added';
}

/** A thumbnail that opens the full photo. The image is loaded through the API (see api.blob). */
function photoLink(a) {
  const img = el('img', { alt: a.name });
  const link = el('a', { href: '#', target: '_blank', rel: 'noopener', 'aria-label': `Open photo ${a.name}` }, img);
  api
    .blob(a.url)
    .then((file) => {
      const url = URL.createObjectURL(file);
      img.src = url;
      link.href = url;
    })
    .catch(() => {
      img.alt = `${a.name} (could not be loaded)`;
    });
  return link;
}

function render(r, user) {
  document.title = `${r.requestNumber} · Green Valley Apartments`;
  const back = user.role === 'resident'
    ? { href: '/resident/requests.html', text: '← My requests' }
    : { href: '/manage/requests.html', text: '← Requests' };

  const details = [
    ['Category', categoryLabel(r.category)],
    ['Location', LOCATION_LABELS[r.location]],
    ['Apartment', r.unit?.unitNumber || '—'],
    ['Submitted by', r.submittedBy?.fullName || '—'],
    ['Submitted', formatDateTime(r.submittedAt)],
    ['Priority', priorityBadge(r.priority)],
    ['Assigned to', r.assignedTo?.fullName || 'Not assigned yet'],
  ];

  const history = r.updates.map((u) =>
    el(
      'li',
      { class: u.isInternal ? 'timeline__item timeline__item--internal' : 'timeline__item' },
      el('strong', { text: describe(u) }),
      u.note ? el('p', { class: 'timeline__note', text: u.note }) : null,
      el(
        'div',
        { class: 'muted small' },
        `${u.author} · `,
        el('time', { datetime: u.createdAt, text: formatDateTime(u.createdAt) }),
      ),
    ),
  );

  replace(
    main,
    el('a', { class: 'back-link', href: back.href, text: back.text }),
    justSubmitted
      ? el('p', { class: 'callout callout--info', role: 'status', text: 'Your request was submitted. The building office will review it soon.' })
      : null,
    el(
      'div',
      { class: 'page-head' },
      el('div', {}, el('p', { class: 'muted', text: r.requestNumber }), el('h1', { text: r.title })),
      statusBadge(r.status),
    ),
    r.allowed.transitions.length || r.allowed.assign || r.allowed.addNote
      ? el(
          'section',
          { class: 'card', 'aria-labelledby': 'actions-title' },
          el('h2', { id: 'actions-title', text: 'Actions' }),
          el(
            'div',
            { class: 'actions' },
            r.allowed.assign ? assignForm(r, user) : null,
            r.allowed.transitions.map((t) => actionForm(r, user, t)),
            r.allowed.addNote ? noteForm(r, user) : null,
          ),
        )
      : null,
    el(
      'div',
      { class: 'grid grid-2' },
      el(
        'section',
        { class: 'card' },
        el('h2', { text: 'Details' }),
        el('dl', { class: 'details' }, details.map(([k, v]) => [el('dt', { text: k }), el('dd', {}, v)])),
      ),
      el('section', { class: 'card' }, el('h2', { text: 'Description' }), el('p', { class: 'prewrap', text: r.description })),
    ),
    r.attachments.length
      ? el(
          'section',
          { class: 'card' },
          el('h2', { text: 'Photos' }),
          el(
            'div',
            { class: 'photos' },
            r.attachments.map(photoLink),
          ),
        )
      : null,
    el('section', { class: 'card' }, el('h2', { text: 'History' }), el('ol', { class: 'timeline' }, history)),
  );
  animateList([...main.querySelectorAll('.card')]);
}

try {
  const user = await initLayout({ active: 'requests' });
  if (!user) {
    replace(main, el('p', { class: 'callout callout--warn', text: 'Choose a demo user in the “Viewing as” menu to open this request.' }));
  } else {
    render(await api.get(`/maintenance/requests/${encodeURIComponent(params.get('id') || '0')}`), user);
  }
} catch (err) {
  // A missing or someone else's request cannot be fixed by retrying.
  const box = el('section', { class: 'card' }, errorState(err, err.status === 404 ? null : () => location.reload()));
  replace(main, box);
  animateIn(box);
}
