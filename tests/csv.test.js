'use strict';
/** Unit tests for the CSV export helper (FR-38). Run with `npm test`. */
const test = require('node:test');
const assert = require('node:assert/strict');
const { toCsv } = require('../server/lib/csv');

test('CSV: UTF-8 mark, quoted cells, Bangla kept, empty values blank', () => {
  const csv = toCsv(['Name', 'Note'], [['সাদিয়া ইসলাম', 'says "hi", then\nleaves'], ['Tanvir', null]]);
  assert.ok(csv.startsWith('﻿"Name","Note"\r\n'));
  assert.ok(csv.includes('"সাদিয়া ইসলাম","says ""hi"", then\nleaves"\r\n'));
  assert.ok(csv.endsWith('"Tanvir",\r\n'));
});

test('CSV: text that a spreadsheet would run as a formula stays text', () => {
  for (const evil of ['=HYPERLINK("http://x")', '+1+1', '-2', '@SUM(A1)', '\tx']) {
    const line = toCsv(['t'], [[evil]]).split('\r\n')[1];
    assert.ok(line.startsWith(`"'`), evil);
  }
  assert.equal(toCsv(['t'], [['Tap leaking']]).split('\r\n')[1], '"Tap leaking"');
});
