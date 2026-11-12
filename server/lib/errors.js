'use strict';
/**
 * Errors the API can return. Each has an HTTP status, a stable `code` the
 * frontend can check, and a plain-language message for the user (NFR-11).
 *
 *   throw notFound('We could not find that request.');
 */
class HttpError extends Error {
  constructor(status, code, message, fields) {
    super(message);
    this.status = status;
    this.code = code;
    if (fields) this.fields = fields; // { fieldName: 'what is wrong with it' } for forms (UI-04)
  }
}

const badRequest = (message, fields) => new HttpError(400, 'VALIDATION_FAILED', message, fields);
const unauthorized = (message = 'Please choose who you are viewing as.') => new HttpError(401, 'NO_USER', message);
const forbidden = (message = 'You do not have permission to do this.') => new HttpError(403, 'FORBIDDEN', message);
// Other people's records answer "not found", never "forbidden", so IDs cannot be probed (FR-02, NFR-24).
const notFound = (message = 'We could not find that.') => new HttpError(404, 'NOT_FOUND', message);

module.exports = { HttpError, badRequest, unauthorized, forbidden, notFound };
