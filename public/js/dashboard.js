/**
 * Administrative dashboard (admin only).
 *   FR-27 units and residents, FR-28 billing, FR-29 maintenance counts,
 *   FR-30 recent activity and search.
 *
 * Data from the server is always inserted with textContent, never innerHTML,
 * so it cannot inject script.
 */
import { api } from './api.js';
import { initLayout } from './layout.js';

const message = document.getElementById('message');
const dashboard = document.getElementById('dashboard');
const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search-input');
const searchMessage = document.getElementById('search-message');
const searchResults = document.getElementById('search-results');

const STATUS_TEXT = {
  submitted: 'Submitted', under_review: 'Under review', in_progress: 'In progress',
  resolved: 'Resolved', closed: 'Closed', rejected: 'Rejected', cancelled: 'Cancelled',
};

// Announcement categories, as in the announcements module.
const CATEGORY_TEXT = { service: 'Service', maintenance: 'Maintenance', meeting: 'Meeting', rules: 'Rules' };

/** Taka amount like ৳12,500 */
function taka(amount) {
  return '৳' + amount.toLocaleString('en-IN');
}

/** Adds one stat card (a number and a label) to a container. */
function addCard(container, value, label, isAlert) {
  const card = document.createElement('div');
  card.className = isAlert ? 'card card-alert' : 'card';
  const number = document.createElement('span');
  number.className = 'card-value';
  number.textContent = String(value);
  const text = document.createElement('span');
  text.className = 'card-label';
  text.textContent = label;
  card.append(number, text);
  container.append(card);
}

// ---------- Showing the page for the chosen user ----------

async function showPage(user) {
  dashboard.hidden = true;
  message.textContent = '';

  if (!user) {
    message.textContent = 'Please log in.';
    return;
  }
  if (user.role !== 'admin') {
    message.textContent = 'The dashboard is only available to the admin.';
    return;
  }

  try {
    const data = await api.get('/dashboard');
    showNumbers(data);
    dashboard.hidden = false;
  } catch (err) {
    message.textContent = err.message;
  }
}

function showNumbers(data) {
  // FR-27
  const building = document.getElementById('occupancy-cards');
  building.replaceChildren();
  addCard(building, data.occupancy.totalUnits, 'Total units');
  addCard(building, data.occupancy.occupiedUnits, 'Occupied units');
  addCard(building, data.occupancy.vacantUnits, 'Vacant units');
  addCard(building, data.occupancy.residents, 'Active residents');

  // FR-28
  const billing = document.getElementById('billing-cards');
  billing.replaceChildren();
  addCard(billing, taka(data.billing.collected), 'Collected');
  addCard(billing, taka(data.billing.outstanding), 'Outstanding');
  addCard(billing, data.billing.overdueBills, 'Overdue bills', data.billing.overdueBills > 0);

  // FR-29: maintenance is null until the maintenance module is merged
  const maintenance = document.getElementById('maintenance-cards');
  const maintenanceNote = document.getElementById('maintenance-note');
  maintenance.replaceChildren();
  maintenanceNote.textContent = '';
  if (data.maintenance === null) {
    maintenanceNote.textContent = 'Maintenance data will appear once the maintenance module is merged.';
  } else {
    for (const status of Object.keys(STATUS_TEXT)) {
      addCard(maintenance, data.maintenance.byStatus[status] || 0, STATUS_TEXT[status]);
    }
    addCard(maintenance, data.maintenance.overdue, 'Overdue requests', data.maintenance.overdue > 0);
  }

  // FR-30: recent activity
  const list = document.getElementById('activity-list');
  list.replaceChildren();
  if (data.recentActivity.length === 0) {
    const empty = document.createElement('li');
    empty.textContent = 'No activity yet.';
    list.append(empty);
  }
  for (const item of data.recentActivity) {
    const li = document.createElement('li');
    li.textContent = item.text;
    const time = document.createElement('time');
    time.dateTime = item.at;
    time.textContent = new Date(item.at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });
    li.append(time);
    list.append(li);
  }

  // FR-30: recent announcements (null if the announcements module is not installed)
  const announcementList = document.getElementById('announcement-list');
  const announcementsNote = document.getElementById('announcements-note');
  announcementList.replaceChildren();
  announcementsNote.textContent = '';
  if (data.announcements === null) {
    announcementsNote.textContent = 'Announcements will appear once the announcements module is merged.';
  } else if (data.announcements.length === 0) {
    announcementsNote.textContent = 'No announcements yet.';
  }
  for (const a of data.announcements || []) {
    const li = document.createElement('li');
    li.textContent = `${CATEGORY_TEXT[a.category] || a.category}: ${a.title}`;
    const time = document.createElement('time');
    time.dateTime = a.at;
    time.textContent = new Date(a.at).toLocaleString('en-GB', { timeZone: 'Asia/Dhaka' });
    li.append(time);
    announcementList.append(li);
  }
}

// ---------- FR-30: search ----------

/** Adds a titled group of results; each line is plain text. */
function addGroup(title, lines) {
  if (lines.length === 0) return;
  const group = document.createElement('div');
  group.className = 'result-group';
  const heading = document.createElement('h3');
  heading.textContent = title;
  const ul = document.createElement('ul');
  for (const line of lines) {
    const li = document.createElement('li');
    li.textContent = line;
    ul.append(li);
  }
  group.append(heading, ul);
  searchResults.append(group);
}

searchForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  searchResults.replaceChildren();
  searchMessage.textContent = '';

  const text = searchInput.value.trim();
  if (text.length < 2) {
    searchMessage.textContent = 'Type at least 2 characters to search.';
    return;
  }

  try {
    const found = await api.get('/dashboard/search?q=' + encodeURIComponent(text));

    addGroup('Residents', found.residents.map((r) => {
      const unit = r.units.length ? 'Unit ' + r.units.join(', ') : 'No unit';
      return `${r.fullName} · ${r.email} · ${r.phone || 'no phone'} · ${unit}`;
    }));
    addGroup('Units', found.units.map((u) => `Unit ${u.unitNumber} · floor ${u.floor} · ${u.occupied ? 'Occupied' : 'Vacant'}`));
    addGroup('Bills', found.bills.map((b) => `${b.unitNumber} · ${b.billType} ${b.month} · ${taka(b.total)} · ${b.status}`));
    addGroup('Requests', found.requests.map((r) => `${r.requestNumber} · ${r.title} · ${STATUS_TEXT[r.status] || r.status}`));

    if (searchResults.children.length === 0) searchMessage.textContent = 'Nothing matched "' + text + '".';
  } catch (err) {
    searchMessage.textContent = err.message;
  }
});

initLayout({ active: 'dashboard' }).then(showPage).catch((err) => {
  message.textContent = err.message;
});
