'use strict';
/** Unit tests for days and times in the app's time zone (server/lib/dates.js). Run with `npm test`. */
const test = require('node:test');
const assert = require('node:assert/strict');
const config = require('../server/config');
const { dayOf, startOfDay, addDays, isDay, toIso } = require('../server/lib/dates');

test("the server process runs in the app's time zone, never the computer's own", () => {
  assert.equal(process.env.TZ, config.timezone);
});

test('a moment belongs to its day in the app (UTC+6), whatever the computer’s time zone', () => {
  assert.equal(dayOf(new Date('2026-11-15T20:00:00Z')), '2026-11-16');
  assert.equal(dayOf(new Date('2026-11-15T17:59:59Z')), '2026-11-15');
  assert.equal(startOfDay('2026-11-16').toISOString(), '2026-11-15T18:00:00.000Z');
});

test('days add across months and years; impossible days are refused', () => {
  assert.equal(addDays('2026-12-30', 3), '2027-01-02');
  assert.equal(addDays('2027-03-01', -1), '2027-02-28');
  assert.equal(isDay('2028-02-29'), true);
  for (const bad of ['2027-02-29', '2026-13-01', '2026-1-5', 'today', '', undefined]) assert.equal(isDay(bad), false, String(bad));
});

test('times are written with the offset, never as UTC', () => {
  assert.equal(toIso(new Date('2026-11-15T20:30:00.250Z')), '2026-11-16T02:30:00.250+06:00');
  assert.equal(new Date(toIso('2026-11-15T20:30:00Z')).getTime(), Date.parse('2026-11-15T20:30:00Z'), 'same moment');
});
