/**
 * Login page (FR-01).
 *
 * Sends the email or phone and password to POST /api/v1/auth/login. The server
 * answers with a session cookie that the browser keeps and sends by itself.
 * Afterwards the person goes back to the page they wanted (?next=).
 */
import { api } from '../api.js';

const form = document.getElementById('login-form');
const loginInput = document.getElementById('login');
const passwordInput = document.getElementById('password');
const button = document.getElementById('login-button');
const alertBox = document.getElementById('login-alert');
const fieldErrors = {
  login: document.getElementById('login-error'),
  password: document.getElementById('password-error'),
};
const inputs = { login: loginInput, password: passwordInput };

/** Where to go after logging in. Only addresses on this site are allowed, never another website. */
function nextPage() {
  const next = new URLSearchParams(location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
}

function clearErrors() {
  alertBox.hidden = true;
  alertBox.textContent = '';
  for (const name of Object.keys(fieldErrors)) {
    fieldErrors[name].hidden = true;
    fieldErrors[name].textContent = '';
    inputs[name].removeAttribute('aria-invalid');
  }
}

/** Shows a message next to each field the server named, or one message above the form. */
function showError(err) {
  const names = Object.keys(err.fields || {}).filter((name) => fieldErrors[name]);
  for (const name of names) {
    fieldErrors[name].textContent = err.fields[name];
    fieldErrors[name].hidden = false;
    inputs[name].setAttribute('aria-invalid', 'true');
  }
  if (names.length === 0) {
    alertBox.textContent = err.message;
    alertBox.hidden = false;
  }
  (names.length ? inputs[names[0]] : passwordInput).focus();
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  clearErrors();
  button.disabled = true;
  try {
    await api.post('/auth/login', { login: loginInput.value, password: passwordInput.value });
    location.replace(nextPage());
  } catch (err) {
    passwordInput.value = '';
    showError(err);
    button.disabled = false;
  }
});

// Already logged in? Then there is nothing to do here.
try {
  await api.get('/me');
  location.replace(nextPage());
} catch {
  loginInput.focus();
}
