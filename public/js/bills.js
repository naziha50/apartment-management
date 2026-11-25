/**
 * Bills page.
 *   Admin:    create bills, see every bill, mark a bill as paid.
 *   Resident: see the bills for their own units.
 *   Staff:    no access.
 *
 * Data from the server is always inserted with textContent, never innerHTML,
 * so it cannot inject script.
 */
import { api } from './api.js';
import { initViewingAs } from './viewing-as.js';

const message = document.getElementById('message');
const createSection = document.getElementById('create-section');
const createForm = document.getElementById('create-form');
const billsSection = document.getElementById('bills-section');
const billsHeading = document.getElementById('bills-heading');
const billsBody = document.getElementById('bills-body');

const STATUS_TEXT = { paid: 'Paid', unpaid: 'Unpaid', overdue: 'Overdue' };
const METHOD_TEXT = { cash: 'Cash', bkash: 'bKash', bank: 'Bank' };

let currentUser = null;

// ---------- Showing the page for the chosen user ----------

async function showPage(user) {
  currentUser = user;
  createSection.hidden = true;
  billsSection.hidden = true;
  message.textContent = '';

  if (!user) {
    message.textContent = 'Choose a user from the "Viewing as" menu.';
    return;
  }
  if (user.role === 'staff') {
    message.textContent = 'Billing is only available to the admin and residents.';
    return;
  }

  try {
    if (user.role === 'admin') {
      await loadUnits();
      createSection.hidden = false;
      billsHeading.textContent = 'All bills';
    } else {
      billsHeading.textContent = 'My bills';
    }
    await loadBills();
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

/** Loads the bills and draws one table row per bill. */
async function loadBills() {
  const { items } = await api.get('/bills');
  billsSection.hidden = false;
  billsBody.replaceChildren();

  if (items.length === 0) {
    const row = billsBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 6;
    cell.textContent = 'There are no bills yet.';
    return;
  }

  for (const bill of items) {
    const row = billsBody.insertRow();
    row.insertCell().textContent = bill.unitNumber;
    row.insertCell().textContent = bill.title;
    row.insertCell().textContent = `৳${bill.amount.toLocaleString('en-IN')}`;
    row.insertCell().textContent = bill.dueDate;

    const status = document.createElement('span');
    status.className = `badge badge-${bill.status}`;
    status.textContent = STATUS_TEXT[bill.status];
    row.insertCell().append(status);

    const paymentCell = row.insertCell();
    if (bill.status === 'paid') {
      paymentCell.textContent = `${METHOD_TEXT[bill.paymentMethod]} on ${bill.paidOn}`;
    } else if (currentUser.role === 'admin') {
      paymentCell.append(makePayControls(bill));
    } else {
      paymentCell.textContent = 'Not paid yet';
    }
  }
}

/** For the admin: a payment-method drop-down and a "Mark as paid" button. */
function makePayControls(bill) {
  const wrap = document.createElement('div');
  wrap.className = 'pay-controls';

  const method = document.createElement('select');
  method.setAttribute('aria-label', `Payment method for ${bill.title}`);
  for (const [value, text] of Object.entries(METHOD_TEXT)) method.append(new Option(text, value));

  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Mark as paid';
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api.post(`/bills/${bill.id}/payment`, { method: method.value });
      message.textContent = `Payment recorded for "${bill.title}" (unit ${bill.unitNumber}).`;
      await loadBills();
    } catch (err) {
      message.textContent = err.message;
      button.disabled = false;
    }
  });

  wrap.append(method, button);
  return wrap;
}

// ---------- Create a bill (admin) ----------

createForm.addEventListener('submit', async (event) => {
  event.preventDefault(); // stop the browser reloading the page
  showFieldErrors({});

  const form = createForm.elements;
  const newBill = {
    unitId: Number(form.unitId.value) || null,
    title: form.title.value,
    amount: Number(form.amount.value),
    dueDate: form.dueDate.value,
  };

  try {
    const { bill } = await api.post('/bills', newBill);
    message.textContent = `Bill "${bill.title}" created for unit ${bill.unitNumber}.`;
    createForm.reset();
    await loadBills();
  } catch (err) {
    message.textContent = err.message;
    showFieldErrors(err.fields || {});
  }
});

/** Shows the server's message under each field that has a problem. */
function showFieldErrors(fields) {
  for (const span of createForm.querySelectorAll('.field-error')) {
    span.textContent = fields[span.dataset.for] || '';
  }
}

// ---------- Start ----------

initViewingAs(document.getElementById('viewing-as'), showPage).catch((err) => {
  message.textContent = `Could not load users: ${err.message}`;
});
