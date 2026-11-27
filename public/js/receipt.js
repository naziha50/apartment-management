/**
 * Payment receipt (FR-14): view it, print / save as PDF, or download a text file.
 * A resident can only open receipts for their own units; the server answers 404 otherwise.
 *
 * Data from the server is always inserted with textContent, never innerHTML.
 */
import { api } from './api.js';
import { initViewingAs } from './viewing-as.js';
import { METHOD_TEXT, billLabel, taka, receiptNumber } from './bill-format.js';

const paymentId = new URLSearchParams(location.search).get('id');

const message = document.getElementById('message');
const receiptSection = document.getElementById('receipt-section');
let receiptText = ''; // the text of the downloadable file

async function showPage(user) {
  receiptSection.hidden = true;
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
    const { payment } = await api.get(`/payments/${encodeURIComponent(paymentId)}`);
    draw(payment);
  } catch (err) {
    message.textContent = err.message;
  }
}

function draw(payment) {
  const number = receiptNumber(payment.id);
  const bill = billLabel(payment.billType, payment.billMonth);
  const resident = payment.residentNames || 'No current resident';

  document.getElementById('r-number').textContent = number;
  document.getElementById('r-building').textContent = payment.buildingName;
  document.getElementById('r-resident').textContent = resident;
  document.getElementById('r-unit').textContent = payment.unitNumber;
  document.getElementById('r-bill').textContent = bill;
  document.getElementById('r-amount').textContent = taka(payment.amount);
  document.getElementById('r-date').textContent = payment.paidOn;
  document.getElementById('r-method').textContent = METHOD_TEXT[payment.method];
  document.getElementById('r-recorded').textContent = payment.recordedBy;
  receiptSection.hidden = false;

  receiptText = [
    `PAYMENT RECEIPT ${number}`,
    payment.buildingName,
    '',
    `Resident: ${resident}`,
    `Unit: ${payment.unitNumber}`,
    `Bill: ${bill}`,
    `Amount paid: ${taka(payment.amount)}`,
    `Date: ${payment.paidOn}`,
    `Method: ${METHOD_TEXT[payment.method]}`,
    `Recorded by: ${payment.recordedBy}`,
    '',
  ].join('\r\n');
}

document.getElementById('print-button').addEventListener('click', () => window.print());

// Build a plain text file in the browser and ask the browser to save it.
document.getElementById('download-button').addEventListener('click', () => {
  const blob = new Blob([receiptText], { type: 'text/plain;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `receipt-${receiptNumber(paymentId)}.txt`;
  link.click();
  URL.revokeObjectURL(link.href);
});

initViewingAs(document.getElementById('viewing-as'), showPage).catch((err) => {
  message.textContent = `Could not load users: ${err.message}`;
});
