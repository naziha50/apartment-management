'use strict';
/**
 * ESLint settings: checks the JavaScript for mistakes and for our style rules.
 *
 *   npm run lint
 *
 * Uses ESLint's recommended rules plus a few from the Airbnb JavaScript Style
 * Guide (no `var`, prefer `const`, always `===`).
 */
const js = require('@eslint/js');
const globals = require('globals');

const styleRules = {
  'no-var': 'error', // use let or const
  'prefer-const': 'error', // const when the value never changes
  eqeqeq: ['error', 'smart'], // === instead of ==
  'no-irregular-whitespace': ['error', { skipTemplates: true }], // allows the byte-order mark in the CSV export
  'no-unused-vars': ['error', { argsIgnorePattern: '^_|^next$|^req$|^res$' }],
};

module.exports = [
  { ignores: ['node_modules/', 'docs/', 'public/vendor/', 'coverage/', 'storage/', 'backups/'] },
  { linterOptions: { reportUnusedDisableDirectives: 'off' } },
  js.configs.recommended,

  // Server, database scripts and tools: Node.js, CommonJS modules (require).
  {
    files: ['server/**/*.js', 'db/**/*.js', 'scripts/**/*.js', 'tests/**/*.js', 'eslint.config.js'],
    languageOptions: { sourceType: 'commonjs', globals: globals.node },
    rules: styleRules,
  },

  // Tests written as ES modules.
  {
    files: ['tests/**/*.mjs'],
    languageOptions: { sourceType: 'module', globals: globals.node },
    rules: styleRules,
  },

  // Pages in the browser: ES modules (import/export).
  {
    files: ['public/js/**/*.js'],
    languageOptions: { sourceType: 'module', globals: globals.browser },
    rules: styleRules,
  },
];
