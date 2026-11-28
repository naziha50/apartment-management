/**
 * Announcements. The admin publishes, edits and deletes them and sees how many
 * residents have read each one. Residents read theirs; unread ones say "New".
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { formatDateTime } from '../format.js';
import { initLayout, setBellCount } from '../layout.js';
import { animateList, emptyState, errorState, pagination, showFieldErrors, toast, withBusy } from '../ui.js';

const editorBox = $('#editor');
const content = $('#content');
const markAll = $('#mark-all');
const CATEGORY = {
  service: 'Service interruption',
  maintenance: 'Maintenance work',
  meeting: 'Meeting',
  rules: 'Building rules',
};

let isAdmin = false;
let currentPage = 1;

const field = (name, label, control) => el('div', { class: 'field' }, el('label', { for: `n-${name}`, text: label }), control);

/** The publish / edit form. `item` is null for a new announcement. */
function showEditor(item) {
  const category = el(
    'select',
    { id: 'n-category', name: 'category' },
    [['', 'Choose one'], ...Object.entries(CATEGORY)].map(([value, text]) => el('option', { value, text })),
  );
  category.value = item?.category || '';
  const message = el('textarea', { id: 'n-body', name: 'body', maxlength: 5000 });
  message.value = item?.body || '';
  const form = el(
    'form',
    { class: 'form', novalidate: true },
    field('title', 'Title', el('input', { id: 'n-title', name: 'title', type: 'text', maxlength: 150, value: item?.title || '' })),
    field('category', 'Category', category),
    field('body', 'Message', message),
  );
  const submit = el('button', { type: 'submit', class: 'btn btn-primary', text: item ? 'Save changes' : 'Publish' });
  const cancel = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Cancel', onclick: () => showEditor(null) });
  form.append(el('div', { class: 'form-actions' }, submit, item ? cancel : null));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const body = Object.fromEntries(new FormData(form));
    await withBusy(
      submit,
      async () => {
        try {
          if (item) {
            await api.patch(`/announcements/${item.id}`, body);
            toast('Announcement saved.', 'ok');
          } else {
            const { sentTo } = await api.post('/announcements', body);
            toast(`Published to ${sentTo} ${sentTo === 1 ? 'resident' : 'residents'}.`, 'ok');
          }
          showEditor(null);
          await load(item ? currentPage : 1);
        } catch (err) {
          showFieldErrors(form, err.fields, err.message);
        }
      },
      'Saving…',
    );
  });

  replace(editorBox, el('h2', { id: 'editor-title', text: item ? 'Edit announcement' : 'New announcement' }), form);
  if (item) {
    editorBox.scrollIntoView({ block: 'start' });
    $('#n-title').focus();
  }
}

/** Runs an action on a button, reloads the list, and shows any error. */
const act = (button, fn) =>
  withBusy(button, async () => {
    try {
      await fn();
      await load(currentPage);
    } catch (err) {
      toast(err.message, 'error');
    }
  });

function actions(a) {
  if (isAdmin) {
    const edit = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Edit', 'aria-label': `Edit ${a.title}`, onclick: () => showEditor(a) });
    const remove = el('button', { type: 'button', class: 'btn btn-danger', text: 'Delete', 'aria-label': `Delete ${a.title}` });
    remove.addEventListener('click', () => {
      if (!window.confirm(`Delete “${a.title}”? This cannot be undone.`)) return;
      act(remove, async () => {
        await api.delete(`/announcements/${a.id}`);
        showEditor(null);
        toast('Announcement deleted.', 'ok');
      });
    });
    return el('div', { class: 'row' }, edit, remove);
  }
  if (a.read) return null;
  const read = el('button', { type: 'button', class: 'btn btn-secondary', text: 'Mark as read', 'aria-label': `Mark ${a.title} as read` });
  read.addEventListener('click', () => act(read, () => api.post(`/notifications/${a.notificationId}/read`)));
  return el('div', { class: 'row' }, read);
}

function card(a) {
  const details = [
    CATEGORY[a.category],
    formatDateTime(a.createdAt),
    a.updatedAt ? 'edited' : null,
    isAdmin ? `read by ${a.readBy} of ${a.sentTo}` : null,
  ];
  return el(
    'article',
    { class: 'card form', id: `a-${a.id}` },
    el(
      'div',
      {},
      el('h2', {}, a.title, !isAdmin && !a.read ? el('span', { class: 'notice__new', text: 'New' }) : null),
      el('p', { class: 'muted small', text: details.filter(Boolean).join(' · ') }),
    ),
    el('p', { class: 'announcement-body', text: a.body }),
    actions(a),
  );
}

async function load(page) {
  currentPage = page;
  try {
    const data = await api.get(`/announcements?page=${page}`);
    if (!isAdmin) {
      markAll.hidden = !data.unread;
      const { unread } = await api.get('/notifications/unread-count');
      setBellCount(unread);
    }
    const cards = data.items.map(card);
    const empty = emptyState('No announcements yet.', isAdmin ? 'Publish the first one above.' : 'New notices will appear here.');
    replace(content, cards.length ? cards : empty, pagination(data, load));
    animateList(cards);
  } catch (err) {
    replace(content, errorState(err, () => load(page)));
  }
}

markAll.addEventListener('click', () => act(markAll, () => api.post('/announcements/read-all')));

try {
  const user = await initLayout({ active: 'announcements' });
  if (!['admin', 'resident'].includes(user?.role)) {
    replace(content, emptyState('This page is for residents and the admin.', 'Choose one in the “Viewing as” menu.'));
  } else {
    isAdmin = user.role === 'admin';
    editorBox.hidden = !isAdmin;
    if (isAdmin) showEditor(null);
    await load(1);
    // A notification links to one announcement (#a-12), which exists only after loading.
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
  }
} catch (err) {
  replace(content, errorState(err, () => location.reload()));
}
