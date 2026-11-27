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
import { LOCATION_LABELS, NEEDS_ACTION, PRIORITY_LABELS, STATUS_LABELS, categoryLabel, formatDate, formatDateTime, overdueBadge, priorityBadge, statusBadge } from '../format.js';
import { initLayout } from '../layout.js';
import { MAX_FILES, appendPhotos, photoField, photoProblem, watchPhotos } from '../photos.js';
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
  // Appendix A: the admin closes a scheduled job's request; there is no resident to confirm it.
  office_close: { label: 'Close request', hint: 'The scheduled job is done. This closes the request.', submit: 'Close request' },
  cancelled: { label: 'Cancel request', hint: 'Use this if the problem has gone away. This cannot be undone.', submit: 'Cancel request', danger: true },
  reopen: { label: 'It is not fixed', hint: 'Tell us what is still wrong. The request goes back to In progress.', submit: 'Reopen request' },
};

/** One move as a disclosure: the summary names it; inside are the fields it needs and a confirm button. */
function actionForm(r, user, t) {
  const a = ACTIONS[t.kind || t.to];
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
  // BR-19: e.g. before/after pictures of the repair, while the request has room (3 photos in all).
  const room = MAX_FILES - r.attachments.length;
  const photos = room > 0 ? photoField('note-photos', room) : null;
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    el('p', { class: 'hint', text: 'Tell the resident how the work is going, or leave an internal note for staff.' }),
    el('div', { class: 'field' }, el('label', { for: 'note-text', text: 'Note' }), el('textarea', { id: 'note-text', name: 'note', maxlength: 2000, required: true })),
    photos ? photos.field : el('p', { class: 'hint', text: `This request already has ${MAX_FILES} photos, the most allowed.` }),
    el('label', { class: 'choice' }, internal, ' Internal note (only staff and the admin can see it, photos included)'),
    el('div', { class: 'form-actions' }, button),
  );
  if (photos) watchPhotos(form, photos.input, photos.preview);
  onSubmit(form, button, user, `/maintenance/requests/${r.id}/notes`, () => ({ internal: internal.checked }), () => (internal.checked ? 'Internal note added.' : 'Note added.'));
  return el('details', { class: 'action' }, el('summary', { text: 'Add a note' }), form);
}

// FR-50: what each star means, so the choice is clear in words and not only in stars.
const RATING_LABELS = { 1: 'Very poor', 2: 'Poor', 3: 'OK', 4: 'Good', 5: 'Excellent' };

/** A rating as stars (hidden from screen readers) plus words. */
function ratingText(n) {
  return [el('span', { class: 'stars', 'aria-hidden': 'true', text: '★'.repeat(n) + '☆'.repeat(5 - n) }), ` ${n} out of 5 – ${RATING_LABELS[n]}`];
}

/** FR-50 / BR-26: the resident rates the repair once; it cannot be changed afterwards. */
function rateForm(r, user) {
  const button = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Send rating' });
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    el('p', { class: 'hint', text: 'Your rating helps the building office. You can rate once, and it cannot be changed.' }),
    el(
      'fieldset',
      { class: 'field' },
      el('legend', { text: 'How well was it fixed?' }),
      el(
        'div',
        { class: 'choice-row' },
        [1, 2, 3, 4, 5].map((n) => el('label', { class: 'choice' }, el('input', { type: 'radio', name: 'rating', value: String(n), required: true }), ` ${n} – ${RATING_LABELS[n]}`)),
      ),
    ),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'rating-comment' }, 'Comment ', el('span', { class: 'muted small', text: '(optional)' })),
      el('textarea', { id: 'rating-comment', name: 'comment', maxlength: 500 }),
    ),
    el('div', { class: 'form-actions' }, button),
  );
  onSubmit(form, button, user, `/maintenance/requests/${r.id}/rating`, () => ({}), () => 'Thank you for your rating.');
  return el('details', { class: 'action' }, el('summary', { text: 'Rate this repair' }), form);
}

/** FR-18: change the priority after review. Only the other priorities are offered. */
function priorityForm(r, user) {
  const button = el('button', { type: 'submit', class: 'btn btn-primary', text: 'Change priority' });
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    el('p', { class: 'hint', text: `Currently ${r.priority ? PRIORITY_LABELS[r.priority] : 'not set'}. The change is kept in the history.` }),
    el(
      'div',
      { class: 'field' },
      el('label', { for: 'priority-new', text: 'New priority' }),
      el(
        'select',
        { id: 'priority-new', name: 'priority', required: true },
        el('option', { value: '', text: 'Choose a priority' }),
        ['high', 'medium', 'low'].filter((p) => p !== r.priority).map((p) => el('option', { value: p, text: PRIORITY_LABELS[p] })),
      ),
    ),
    el('div', { class: 'form-actions' }, button),
  );
  onSubmit(form, button, user, `/maintenance/requests/${r.id}/priority`, () => ({}), (u) => `Priority is now ${PRIORITY_LABELS[u.priority].toLowerCase()}.`, 'patch');
  return el('details', { class: 'action' }, el('summary', { text: 'Change priority' }), form);
}

/**
 * Sends a form (POST unless `method` says otherwise), then redraws the page
 * with the request the server sends back. Field errors appear next to their
 * fields; anything else at the top of the form.
 */
function onSubmit(form, button, user, path, extra, message, method = 'post') {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    // With photos chosen the form goes as multipart; otherwise as JSON (file inputs left out).
    const fileInput = form.querySelector('input[type="file"]');
    let body;
    if (fileInput?.files.length) {
      const problem = photoProblem([...fileInput.files], Number(fileInput.dataset.max) || MAX_FILES);
      if (problem) return showFieldErrors(form, { [fileInput.name]: problem });
      body = new FormData(form);
      for (const [key, value] of Object.entries(extra())) body.set(key, String(value));
      appendPhotos(body, fileInput);
    } else {
      body = { ...extra(), ...Object.fromEntries([...new FormData(form)].filter(([, v]) => !(v instanceof File))) };
    }
    await withBusy(button, async () => {
      try {
        const updated = await api[method](path, body);
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

// Photo API url -> promise of an in-memory blob: URL. Photos never change, so every redraw
// after an action reuses the same copy instead of downloading it again (and leaking the old one).
const photoCache = new Map();

/** A thumbnail that opens the full photo. The image is loaded through the API (see api.blob). */
function photoLink(a) {
  const img = el('img', { alt: a.name });
  const link = el('a', { href: '#', target: '_blank', rel: 'noopener', 'aria-label': `Open photo ${a.name}` }, img);
  if (!photoCache.has(a.url)) photoCache.set(a.url, api.blob(a.url).then((file) => URL.createObjectURL(file)));
  photoCache
    .get(a.url)
    .then((url) => {
      img.src = url;
      link.href = url;
    })
    .catch(() => {
      photoCache.delete(a.url); // try again on the next redraw
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
    // BR-25: requests from a scheduled task have no resident; the system created them.
    ['Submitted by', r.submittedBy?.fullName || (r.scheduledTask ? 'System (scheduled task)' : '—')],
    r.scheduledTask ? ['Scheduled job due', formatDate(r.scheduledTask.dueDate)] : null,
    ['Submitted', formatDateTime(r.submittedAt)],
    ['Priority', priorityBadge(r.priority)],
    ['Assigned to', r.assignedTo?.fullName || 'Not assigned yet'],
  ];
  // BR-17: the office's target time, while someone still has to act on the request.
  if (user.role !== 'resident' && NEEDS_ACTION.split(',').includes(r.status)) {
    details.push([r.priority ? 'Resolve by' : 'Review by', [formatDateTime(r.dueAt), r.overdue ? overdueBadge() : null]]);
  }
  if (r.rating) {
    details.push(['Rating', [ratingText(r.rating.rating), r.rating.comment ? el('p', { class: 'timeline__note', text: `“${r.rating.comment}”` }) : null]]);
  }

  // BR-19: photos reported with the request go in the Photos card; photos added with a note sit under that note.
  const reportPhotos = r.attachments.filter((a) => a.updateId == null);
  const noteHasPhotos = (u) => r.attachments.some((a) => a.updateId === u.id);

  const history = r.updates.map((u) =>
    el(
      'li',
      { class: u.isInternal ? 'timeline__item timeline__item--internal' : 'timeline__item' },
      el('strong', { text: describe(u) }),
      u.note ? el('p', { class: 'timeline__note', text: u.note }) : null,
      noteHasPhotos(u) ? el('div', { class: 'photos timeline__photos' }, r.attachments.filter((a) => a.updateId === u.id).map(photoLink)) : null,
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
    // BR-18: a resolved request closes by itself; say when, so nobody is surprised.
    r.autoCloseAt
      ? el(
          'p',
          { class: 'callout callout--info' },
          r.scheduledTask
            ? `Scheduled job done. Waiting for the admin to close it; otherwise it closes automatically on ${formatDate(r.autoCloseAt)}.`
            : user.role === 'resident'
            ? `Please check the fix. If the problem is still there, choose “It is not fixed” below. Otherwise this request closes automatically on ${formatDate(r.autoCloseAt)}.`
            : `Waiting for the resident to confirm. It closes automatically on ${formatDate(r.autoCloseAt)} unless they reopen it.`,
        )
      : null,
    r.allowed.transitions.length || r.allowed.assign || r.allowed.addNote || r.allowed.setPriority || r.allowed.rate
      ? el(
          'section',
          { class: 'card', 'aria-labelledby': 'actions-title' },
          el('h2', { id: 'actions-title', text: 'Actions' }),
          el(
            'div',
            { class: 'actions' },
            r.allowed.assign ? assignForm(r, user) : null,
            r.allowed.transitions.map((t) => actionForm(r, user, t)),
            r.allowed.setPriority ? priorityForm(r, user) : null,
            r.allowed.addNote ? noteForm(r, user) : null,
            r.allowed.rate ? rateForm(r, user) : null,
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
        el('dl', { class: 'details' }, details.filter(Boolean).map(([k, v]) => [el('dt', { text: k }), el('dd', {}, v)])),
      ),
      el('section', { class: 'card' }, el('h2', { text: 'Description' }), el('p', { class: 'prewrap', text: r.description })),
    ),
    reportPhotos.length
      ? el(
          'section',
          { class: 'card' },
          el('h2', { text: 'Photos' }),
          el(
            'div',
            { class: 'photos' },
            reportPhotos.map(photoLink),
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
