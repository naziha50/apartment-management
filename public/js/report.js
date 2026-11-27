/**
 * Billing report (FR-15), admin only.
 * Totals follow the month range; the "unpaid dues" table is always as of today.
 *
 * Data from the server is always inserted with textContent, never innerHTML.
 */
import { api } from './api.js';
import { initViewingAs } from './viewing-as.js';
import { taka } from './bill-format.js';

const message = document.getElementById('message');
const reportSection = document.getElementById('report-section');
const rangeForm = document.getElementById('range-form');
const duesBody = document.getElementById('dues-body');

async function showPage(user) {
  reportSection.hidden = true;
  message.textContent = '';

  if (!user) {
    message.textContent = 'Choose a user from the "Viewing as" menu.';
    return;
  }
  if (user.role !== 'admin') {
    message.textContent = 'The billing report is only available to the admin.';
    return;
  }
  await loadReport();
}

/** Asks the server for the report for the chosen months and draws it. */
async function loadReport() {
  showFieldErrors({});
  message.textContent = '';

  // Only send the months that were filled in; none means all time.
  const params = new URLSearchParams();
  if (rangeForm.elements.from.value) params.set('from', rangeForm.elements.from.value);
  if (rangeForm.elements.to.value) params.set('to', rangeForm.elements.to.value);

  try {
    const report = await api.get(`/billing/report?${params}`);
    reportSection.hidden = false;
    document.getElementById('s-billed').textContent = taka(report.billed);
    document.getElementById('s-collected').textContent = taka(report.collected);
    document.getElementById('s-outstanding').textContent = taka(report.outstanding);
    drawDues(report.unitsWithDues);
  } catch (err) {
    reportSection.hidden = false;
    message.textContent = err.message;
    showFieldErrors(err.fields || {});
  }
}

function drawDues(units) {
  duesBody.replaceChildren();
  if (units.length === 0) {
    const row = duesBody.insertRow();
    const cell = row.insertCell();
    cell.colSpan = 5;
    cell.textContent = 'No unit has unpaid dues.';
    return;
  }
  for (const unit of units) {
    const row = duesBody.insertRow();
    row.insertCell().textContent = unit.unitNumber;
    row.insertCell().textContent = unit.residentNames || '—';
    row.insertCell().textContent = String(unit.unpaidBills);
    row.insertCell().textContent = taka(unit.amountOwed);
    row.insertCell().textContent = unit.oldestDueDate;
  }
}

rangeForm.addEventListener('submit', (event) => {
  event.preventDefault();
  loadReport();
});

function showFieldErrors(fields) {
  for (const span of rangeForm.querySelectorAll('.field-error')) {
    span.textContent = fields[span.dataset.for] || '';
  }
}

initViewingAs(document.getElementById('viewing-as'), showPage).catch((err) => {
  message.textContent = `Could not load users: ${err.message}`;
});
