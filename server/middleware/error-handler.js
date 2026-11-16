'use strict';
/**
 * Every API error is answered in one JSON shape:
 *   { "error": { "code": "NOT_FOUND", "message": "...", "fields": { ... } } }
 * Unexpected errors are logged on the server; the user only sees a plain
 * message, never a stack trace (NFR-11).
 */
const { HttpError } = require('../lib/errors');
const { toIso } = require('../lib/dates');

function apiNotFound(req, res) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'This API endpoint does not exist.' } });
}

// Express recognises error handlers by their four arguments.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
  let error = err instanceof HttpError ? err : null;
  if (!error && err.type === 'entity.parse.failed') {
    error = new HttpError(400, 'BAD_JSON', 'The request could not be read.');
  }
  // Other client mistakes Express itself reports, e.g. 413 when a JSON body is over 100 KB.
  if (!error && err.expose && err.status >= 400 && err.status < 500) {
    error = new HttpError(err.status, 'BAD_REQUEST', err.status === 413 ? 'The request is too large.' : 'The request could not be read.');
  }
  if (!error) {
    console.error(`[${toIso(new Date())}] ${req.method} ${req.originalUrl}`, err);
    error = new HttpError(500, 'SERVER_ERROR', 'Something went wrong on our side. Please try again in a moment.');
  }
  const body = { error: { code: error.code, message: error.message } };
  if (error.fields) body.error.fields = error.fields;
  res.status(error.status).json(body);
}

module.exports = { errorHandler, apiNotFound };
