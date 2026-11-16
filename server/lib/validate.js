'use strict';
/**
 * Server-side input checking (NFR-04). It collects every problem at once, so
 * the form can show each message next to its own field (UI-04), in plain
 * words (NFR-11).
 *
 *   const v = new Validator(req.body);
 *   const title = v.text('title', { min: 3, max: 120, label: 'Title' });
 *   v.throwIfInvalid();   // 400 with { fields: { title: '...' } }
 */
const { badRequest } = require('./errors');

/** "a category", "an apartment" */
const withArticle = (label) => `${/^[aeiou]/i.test(label) ? 'an' : 'a'} ${label.toLowerCase()}`;

class Validator {
  constructor(source) {
    this.source = source || {};
    this.errors = {};
  }

  /** Records a problem for a field (only the first one per field is kept). */
  fail(field, message) {
    if (!this.errors[field]) this.errors[field] = message;
  }

  /** Trimmed text, or null if empty and not required. */
  text(field, { required = true, min = 0, max = 10000, label = field } = {}) {
    const raw = this.source[field];
    const value = raw == null ? '' : String(raw).trim();
    if (!value) {
      if (required) this.fail(field, `${label} is required.`);
      return null;
    }
    if (value.length < min) this.fail(field, `${label} must be at least ${min} characters.`);
    if (value.length > max) this.fail(field, `${label} must be ${max} characters or fewer.`);
    return value;
  }

  /** One value from a fixed list. */
  oneOf(field, allowed, { required = true, label = field } = {}) {
    const value = this.source[field];
    if (value == null || value === '') {
      if (required) this.fail(field, `Please choose ${withArticle(label)}.`);
      return null;
    }
    if (!allowed.includes(value)) {
      this.fail(field, `Please choose a valid ${label.toLowerCase()}.`);
      return null;
    }
    return value;
  }

  /** A positive whole number such as a record id. */
  id(field, { required = true, label = field } = {}) {
    const raw = this.source[field];
    if (raw == null || raw === '') {
      if (required) this.fail(field, `Please choose ${withArticle(label)}.`);
      return null;
    }
    const n = Number(raw);
    if (!Number.isSafeInteger(n) || n <= 0) {
      this.fail(field, `Please choose a valid ${label.toLowerCase()}.`);
      return null;
    }
    return n;
  }

  /** A calendar date as YYYY-MM-DD (what <input type="date"> sends), or null if empty and not required. */
  date(field, { required = true, label = field } = {}) {
    const raw = this.source[field];
    if (raw == null || raw === '') {
      if (required) this.fail(field, `${label} is required.`);
      return null;
    }
    const value = String(raw);
    const d = new Date(`${value}T00:00:00Z`);
    // The round trip rejects dates that do not exist, such as 2026-02-30.
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== value) {
      this.fail(field, `${label} must be a real date.`);
      return null;
    }
    return value;
  }

  get valid() {
    return Object.keys(this.errors).length === 0;
  }

  throwIfInvalid(message = 'Please fix the highlighted fields.') {
    if (!this.valid) throw badRequest(message, this.errors);
  }
}

module.exports = { Validator };
