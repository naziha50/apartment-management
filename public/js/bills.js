/**
 * Bills page.
 *   Admin:    generate monthly bills (FR-09), create a bill, see every bill and
 *             every payment.
 *   Resident: see the bills for their own units, how much they owe (FR-13)
 *             and their payments with receipt links.
 *   Staff:    no access.
 *
 * Data from the server is always inserted with textContent, never innerHTML,
 * so it cannot inject script.
 */
import { api } from './api.js';
import { initLayout } from './layout.js';
import { METHOD_TEXT, billLabel, taka, receiptNumber, statusBadge, makeLink } from './bill-format.js';

const message = document.getElementById('message');
const generateSection = document.getElementById('generate-section');
const generateForm = document.getElementById('generate-form');
const createSection = document.getElementById('create-section');
const createForm = document.getElementById('create-form');
const adminLinks = document.getElementById('admin-links');
const billsSection = document.getElementById('bills-section');
const billsHeading = document.getElementById('bills-heading');
const oweText = document.getElementById('owe-text');
const statusFilter = document.getElementById('status-filter');
const billsBody = document.getElementById('bills-body');
const paymentsSection = document.getElementById('payments-section');
const paymentsHeading = document.getElementById('payments-heading');
const paymentsUnitHeading = document.getElementById('payments-unit-heading');
const paymentsBody = document.getElementById('payments-body');

let currentUser = null;
let allBills = []; // kept so the status filter can work without asking the server again

// ---------- Showing the page for the chosen user ----------

async function showPage(user) {
  currentUser = user;
  generateSection.hidden = true;
  createSection.hidden = true;
  adminLinks.hidden = true;
  billsSection.hidden = true;
  paymentsSection.hidden = true;
  message.textContent = '';

  if (!user) {
    message.textContent = 'Please log in.';
    return;
  }
  if (user.role === 'staff') {
    message.textContent = 'Billing is only available to the admin and residents.';
    return;
  }

  try {
    if (user.role === 'admin') {
      await loadUnits();
      generateSection.hidden = false;
      createSection.hidden = false;
      adminLinks.hidden = false;
      billsHeading.textContent = 'All bills';
      paymentsHeading.textContent = 'All payments';
      paymentsUnitHeading.hidden = false;
    } else {
      billsHeading.textContent = 'My bills';
      paymentsHeading.textContent = 'My payments';
      paymentsUnitHeading.hidden = true;
    }
    await loadBills();
    await loadPayments();
  } catch (err) {
    message.textContent = err.message;
  }
}

/** Fills the unit drop-down in the "Create a bill" form. */
async function loadUnits() {
  const { items } = await api.get('/billing/units');
  const select = createForm.elements.unitId;
  select.replaceChildren(new Option('Choose a unit…', ''));
  for (const unit of items) select.append(new Option(unit.unitNumber, String(unit.id)));
}

// ---------- Bills table (FR-12) ----------

/** Loads the bills from the server, then draws them. */
async function loadBills() {
  const { items } = await api.get('/bills');
  allBills = items;
  billsSection.hidden = false;
  showOwed();
  drawBills();
}

/** "You owe ৳X": the balance of every bill that is not paid (FR-13). */
function showOwed() {
  let owed = 0;
  for (const bill of allBills) {
    if (bill.status !== 'paid') owed += bill.balance;
  }
  oweText.textContent = currentUser.role === 'resident' ? `You owe ${taka(owed)}` : `Outstanding in total: ${taka(owed)}`;
}

/** Draws one table row per bill that matches the status filter. */
function drawBills() {
  const wanted = statusFilter.value;
  const shown = allBills.filter((bill) => wanted === 'all' || bill.status === wanted);
  billsBody.replaceChildren();

  if (shown.length === 0) {
    const row = billsBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 7;
    cell.textContent = 'There are no bills to show.';
    return;
  }

  for (const bill of shown) {
    const row = billsBody.insertRow();
    row.insertCell().textContent = bill.unitNumber;
    row.insertCell().textContent = billLabel(bill.billType, bill.billMonth);
    row.insertCell().textContent = taka(bill.total);
    row.insertCell().textContent = taka(bill.balance);
    row.insertCell().textContent = bill.dueDate;
    row.insertCell().append(statusBadge(bill.status));
    row.insertCell().append(makeLink(`/bill.html?id=${bill.id}`, 'View'));
  }
}

statusFilter.addEventListener('change', drawBills);

// ---------- Payments table (FR-13) ----------

async function loadPayments() {
  const { items } = await api.get('/payments');
  paymentsSection.hidden = false;
  paymentsBody.replaceChildren();

  const columns = currentUser.role === 'admin' ? 6 : 5;
  if (items.length === 0) {
    const row = paymentsBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = columns;
    cell.textContent = 'There are no payments yet.';
    return;
  }

  for (const payment of items) {
    const row = paymentsBody.insertRow();
    row.insertCell().textContent = payment.paidOn;
    if (currentUser.role === 'admin') row.insertCell().textContent = payment.unitNumber;
    row.insertCell().textContent = billLabel(payment.billType, payment.billMonth);
    row.insertCell().textContent = taka(payment.amount);
    row.insertCell().textContent = METHOD_TEXT[payment.method];
    row.insertCell().append(makeLink(`/receipt.html?id=${payment.id}`, receiptNumber(payment.id)));
  }
}

// ---------- Generate monthly bills (admin, FR-09) ----------

generateForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFieldErrors(generateForm, {});

  const form = generateForm.elements;
  const body = {
    month: form.month.value,
    billType: form.billType.value,
    dueDate: form.dueDate.value,
    amount: Number(form.amount.value),
    description: form.description.value,
  };

  try {
    const result = await api.post('/bills/generate', body);
    let text = `Created ${result.created} bill(s).`;
    if (result.skipped.length > 0) {
      text += ` Skipped units that already had this bill: ${result.skipped.join(', ')}.`;
    }
    message.textContent = text;
    generateForm.reset();
    await loadBills();
  } catch (err) {
    message.textContent = err.message;
    showFieldErrors(generateForm, err.fields || {});
  }
});

// ---------- Create one bill (admin) ----------

createForm.addEventListener('submit', async (event) => {
  event.preventDefault(); // stop the browser reloading the page
  showFieldErrors(createForm, {});

  const form = createForm.elements;
  const newBill = {
    unitId: Number(form.unitId.value) || null,
    billType: form.billType.value,
    month: form.month.value,
    dueDate: form.dueDate.value,
    amount: Number(form.amount.value),
    description: form.description.value,
  };

  try {
    const { bill } = await api.post('/bills', newBill);
    message.textContent = `Bill "${billLabel(bill.billType, bill.billMonth)}" created for unit ${bill.unitNumber}.`;
    createForm.reset();
    await loadBills();
  } catch (err) {
    message.textContent = err.message;
    showFieldErrors(createForm, err.fields || {});
  }
});

/** Shows the server's message under each field of a form that has a problem. */
function showFieldErrors(form, fields) {
  for (const span of form.querySelectorAll('.field-error')) {
    span.textContent = fields[span.dataset.for] || '';
  }
}

// ---------- Start ----------

initLayout({ active: 'bills' }).then(showPage).catch((err) => {
  message.textContent = `Could not load users: ${err.message}`;
});
