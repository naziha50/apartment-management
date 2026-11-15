/**
 * FR-21: one maintenance request — its details and its history (FR-20).
 * Opened as /request.html?id=123. The server decides who may see it and
 * answers "not found" for anyone else (NFR-24).
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { LOCATION_LABELS, STATUS_LABELS, categoryLabel, formatDateTime, priorityBadge, statusBadge } from '../format.js';
import { initLayout } from '../layout.js';
import { animateIn, animateList, errorState } from '../ui.js';

const main = $('#main');
const params = new URLSearchParams(location.search);

/** One line of history in plain words. */
function describe(u) {
  if (u.kind === 'status_change') {
    return u.fromStatus
      ? `Status changed from ${STATUS_LABELS[u.fromStatus]} to ${STATUS_LABELS[u.toStatus]}`
      : `Request ${STATUS_LABELS[u.toStatus].toLowerCase()}`;
  }
  if (u.kind === 'priority') return 'Priority changed';
  if (u.kind === 'assignment') return 'Assigned to staff';
  return 'Note added';
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
    : { href: '/', text: '← Home' };

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
        u.isInternal ? ' · Internal note' : null,
      ),
    ),
  );

  replace(
    main,
    el('a', { class: 'back-link', href: back.href, text: back.text }),
    params.get('new')
      ? el('p', { class: 'callout callout--info', role: 'status', text: 'Your request was submitted. The building office will review it soon.' })
      : null,
    el(
      'div',
      { class: 'page-head' },
      el('div', {}, el('p', { class: 'muted', text: r.requestNumber }), el('h1', { text: r.title })),
      statusBadge(r.status),
    ),
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
  const user = await initLayout({ active: 'myRequests' });
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
