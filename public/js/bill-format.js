/**
 * Small helpers shared by the billing pages: text for statuses, types and
 * methods, and the bill label such as "Service charge – November 2026".
 */
export const STATUS_TEXT = { paid: 'Paid', unpaid: 'Unpaid', overdue: 'Overdue' };
export const METHOD_TEXT = { cash: 'Cash', bkash: 'bKash', bank: 'Bank' };
export const TYPE_TEXT = { service_charge: 'Service charge', rent: 'Rent', utility: 'Utility', other: 'Other' };

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'];

/** "2026-11-01" becomes "November 2026". */
export function monthText(billMonth) {
  const [year, month] = billMonth.split('-');
  return `${MONTH_NAMES[Number(month) - 1]} ${year}`;
}

/** The label users see for a bill, e.g. "Service charge – November 2026". */
export function billLabel(billType, billMonth) {
  return `${TYPE_TEXT[billType]} – ${monthText(billMonth)}`;
}

/** 3000 becomes "৳3,000". */
export function taka(amount) {
  return `৳${amount.toLocaleString('en-IN')}`;
}

/** Receipt number shown to users, e.g. "R-000012". */
export function receiptNumber(paymentId) {
  return `R-${String(paymentId).padStart(6, '0')}`;
}

/** A coloured status badge element. */
export function statusBadge(status) {
  const badge = document.createElement('span');
  badge.className = `badge badge-${status}`;
  badge.textContent = STATUS_TEXT[status];
  return badge;
}

/** A link element (text set with textContent). */
export function makeLink(href, text) {
  const a = document.createElement('a');
  a.href = href;
  a.textContent = text;
  return a;
}
