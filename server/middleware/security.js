'use strict';
/**
 * Security headers on every response (NFR-05, OWASP ASVS L1).
 *
 * The Content-Security-Policy only allows scripts and styles from this server.
 * That is why pages never use inline <script> blocks or style="" attributes:
 * all JS lives in public/js and all CSS in public/css.
 */
function securityHeaders(req, res, next) {
  res.set({
    'Content-Security-Policy': [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self'",
      "img-src 'self' data: blob:",
      "connect-src 'self'",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
    'X-Frame-Options': 'DENY',
  });
  next();
}

/** API responses carry personal data: browsers must not cache them (NFR-23). */
function noStore(req, res, next) {
  res.set('Cache-Control', 'no-store');
  next();
}

module.exports = { securityHeaders, noStore };
