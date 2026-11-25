'use strict';
/**
 * CSV for spreadsheet exports (FR-38). Opens correctly in Excel and Google Sheets,
 * including Bangla text: UTF-8 with a byte-order mark (Excel needs it to detect UTF-8)
 * and Windows line endings.
 */

// A cell starting with one of these is run as a formula by Excel and Sheets. User text such as a
// title "=HYPERLINK(...)" must stay text, so it gets a leading apostrophe (OWASP "CSV injection").
const FORMULA_START = /^[=+\-@\t\r]/;

function cell(value) {
  if (value == null) return '';
  let text = String(value);
  if (FORMULA_START.test(text)) text = `'${text}`;
  // Every cell is quoted, so commas, quotes and line breaks inside it are safe.
  return `"${text.replaceAll('"', '""')}"`;
}

/** `rows` are arrays in the same order as `headers`. Returns the whole file as a string. */
function toCsv(headers, rows) {
  return `﻿${[headers, ...rows].map((row) => row.map(cell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { toCsv };
