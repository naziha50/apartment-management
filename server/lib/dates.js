'use strict';
/**
 * Calendar days and times, always in the app's time zone (set once in server/config.js,
 * which also makes it the server process's own zone). A day is 'YYYY-MM-DD' text; a time is
 * ISO text with the zone's offset, e.g. '2026-11-16T08:28:00.000+06:00'.
 */
require('../config'); // sets process.env.TZ, which every Date below relies on

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** The day a moment falls on (default: today). */
function dayOf(moment = new Date()) {
  const d = new Date(moment);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** The moment a day starts; an invalid Date for text that is not 'YYYY-MM-DD'. */
function startOfDay(day) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(Number.NaN);
}

/** The day `days` after (or before, if negative) `day`. */
function addDays(day, days) {
  const d = startOfDay(day);
  d.setDate(d.getDate() + days);
  return dayOf(d);
}

/** Is this a real day? The round trip rejects days that do not exist, such as 2026-02-30. */
const isDay = (text) => !Number.isNaN(startOfDay(text).getTime()) && dayOf(startOfDay(text)) === text;

/** A moment as ISO text with the time zone's offset (what the API sends and the log writes). */
function toIso(moment) {
  const d = new Date(moment);
  const offset = -d.getTimezoneOffset();
  const sign = offset < 0 ? '-' : '+';
  const abs = Math.abs(offset);
  return `${dayOf(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
}

module.exports = { dayOf, startOfDay, addDays, isDay, toIso };
