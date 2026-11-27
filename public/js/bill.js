/**
 * One bill: its charges and payments (FR-10, FR-11).
 *   Admin:    add / remove charges, record payments.
 *   Resident: read-only view of their own bill.
 *
 * Data from the server is always inserted with textContent, never innerHTML.
 */
import { api } from './api.js';
import { initLayout } from './layout.js';
import { METHOD_TEXT, TYPE_TEXT, billLabel, taka, receiptNumber, statusBadge, makeLink } from './bill-format.js';

const billId = new URLSearchParams(location.search).get('id');

const message = document.getElementById('message');
const title = document.getElementById('bill-title');
const billSection = document.getElementById('bill-section');
const chargesBody = document.getElementById('charges-body');
const chargeActionHeading = document.getElementById('charge-action-heading');
const paymentsBody = document.getElementById('payments-body');
const chargeForm = document.getElementById('charge-form');
const paymentForm = document.getElementById('payment-form');

const chargeFormTitle = document.getElementById('charge-form-title');
const chargeSubmit = document.getElementById('charge-submit');
const chargeCancel = document.getElementById('charge-cancel');

let currentUser = null;
let editingChargeId = null; // null = the form adds a new charge; a number = it changes that charge (FR-10)

// ---------- Showing the page for the chosen user ----------

async function showPage(user) {
  currentUser = user;
  billSection.hidden = true;
  title.textContent = 'Bill'; // forget the last user's bill title (NFR-16)
  message.textContent = '';

  if (!user) {
    message.textContent = 'Choose a user from the "Viewing as" menu.';
    return;
  }
  if (user.role === 'staff') {
    message.textContent = 'Billing is only available to the admin and residents.';
    return;
  }
  await loadBill();
}

/** Loads the bill, its charges and its payments, and draws them. */
async function loadBill() {
  try {
    const data = await api.get(`/bills/${encodeURIComponent(billId)}`);
    draw(data.bill, data.charges, data.payments);
  } catch (err) {
    message.textContent = err.message;
  }
}

function draw(bill, charges, payments) {
  const isAdmin = currentUser.role === 'admin';
  billSection.hidden = false;
  chargeForm.hidden = !isAdmin;
  paymentForm.hidden = !isAdmin;
  chargeActionHeading.textContent = isAdmin ? 'Actions' : '';

  title.textContent = billLabel(bill.billType, bill.billMonth);
  document.getElementById('d-unit').textContent = bill.unitNumber;
  document.getElementById('d-due').textContent = bill.dueDate;
  document.getElementById('d-status').replaceChildren(statusBadge(bill.status));
  document.getElementById('d-total').textContent = taka(bill.total);
  document.getElementById('d-paid').textContent = taka(bill.paid);
  document.getElementById('d-balance').textContent = taka(bill.balance);

  // Charges
  chargesBody.replaceChildren();
  if (charges.length === 0) {
    const row = chargesBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 4;
    cell.textContent = 'This bill has no charges.';
  }
  for (const charge of charges) {
    const row = chargesBody.insertRow();
    row.insertCell().textContent = TYPE_TEXT[charge.chargeType];
    row.insertCell().textContent = charge.description;
    row.insertCell().textContent = taka(charge.amount);
    const actionCell = row.insertCell();
    if (isAdmin) actionCell.append(makeEditButton(charge), ' ', makeRemoveButton(charge));
  }

  // Payments
  paymentsBody.replaceChildren();
  if (payments.length === 0) {
    const row = paymentsBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5;
    cell.textContent = 'No payments yet.';
  }
  for (const payment of payments) {
    const row = paymentsBody.insertRow();
    row.insertCell().textContent = payment.paidOn;
    row.insertCell().textContent = taka(payment.amount);
    row.insertCell().textContent = METHOD_TEXT[payment.method];
    row.insertCell().textContent = payment.recordedBy;
    row.insertCell().append(makeLink(`/receipt.html?id=${payment.id}`, receiptNumber(payment.id)));
  }
}

/** A "Remove" button for one charge (admin). */
function makeRemoveButton(charge) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Remove';
  button.setAttribute('aria-label', `Remove charge ${charge.description}`);
  button.addEventListener('click', async () => {
    button.disabled = true;
    try {
      await api.delete(`/bills/${encodeURIComponent(billId)}/charges/${charge.id}`);
      message.textContent = 'Charge removed.';
      await loadBill();
    } catch (err) {
      message.textContent = err.message;
      button.disabled = false;
    }
  });
  return button;
}

/** An "Edit" button for one charge (admin): fills the charge form so it can be changed. */
function makeEditButton(charge) {
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = 'Edit';
  button.setAttribute('aria-label', `Edit charge ${charge.description}`);
  button.addEventListener('click', () => {
    const form = chargeForm.elements;
    form.chargeType.value = charge.chargeType;
    form.description.value = charge.description;
    form.amount.value = String(charge.amount);
    setEditing(charge.id);
    form.description.focus();
  });
  return button;
}

/** Switches the charge form between "add a new charge" (null) and "change this charge" (an id). */
function setEditing(chargeId) {
  editingChargeId = chargeId;
  chargeFormTitle.textContent = chargeId ? 'Edit charge' : 'Add a charge';
  chargeSubmit.textContent = chargeId ? 'Save changes' : 'Add charge';
  chargeCancel.hidden = !chargeId;
  showFieldErrors(chargeForm, {});
  if (!chargeId) chargeForm.reset();
}

chargeCancel.addEventListener('click', () => setEditing(null));

// ---------- Add or change a charge (admin, FR-10) ----------

chargeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFieldErrors(chargeForm, {});

  const form = chargeForm.elements;
  const body = {
    chargeType: form.chargeType.value,
    description: form.description.value,
    amount: Number(form.amount.value),
  };

  try {
    if (editingChargeId) {
      await api.patch(`/bills/${encodeURIComponent(billId)}/charges/${editingChargeId}`, body);
      message.textContent = 'Charge changed.';
    } else {
      await api.post(`/bills/${encodeURIComponent(billId)}/charges`, body);
      message.textContent = 'Charge added.';
    }
    setEditing(null);
    await loadBill();
  } catch (err) {
    message.textContent = err.message;
    showFieldErrors(chargeForm, err.fields || {});
  }
});

// ---------- Record a payment (admin, FR-11) ----------

paymentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showFieldErrors(paymentForm, {});

  const form = paymentForm.elements;
  const body = {
    amount: Number(form.amount.value),
    method: form.method.value,
    paidOn: form.paidOn.value, // empty means "today" on the server
  };

  try {
    await api.post(`/bills/${encodeURIComponent(billId)}/payment`, body);
    message.textContent = 'Payment recorded.';
    paymentForm.reset();
    await loadBill();
  } catch (err) {
    message.textContent = err.message;
    showFieldErrors(paymentForm, err.fields || {});
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
