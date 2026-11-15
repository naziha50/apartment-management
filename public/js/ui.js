/**
 * Reusable UI pieces shared by every page.
 *
 * Animation: Motion (motion.dev, loaded as window.Motion) for small entrance
 * effects and anime.js for number count-ups. Both are skipped when the user's
 * system asks for reduced motion, and the page works fine without them.
 */
import { el, $ } from './dom.js';

export const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Fades and slides a node in. */
export function animateIn(node, { y = 8, delay = 0 } = {}) {
  if (!node || prefersReducedMotion() || !window.Motion?.animate) return;
  window.Motion.animate(
    node,
    { opacity: [0, 1], transform: [`translateY(${y}px)`, 'translateY(0)'] },
    { duration: 0.25, delay, ease: 'easeOut' },
  );
}

/** Animates a list of nodes one after another. */
export function animateList(nodes) {
  nodes.forEach((node, i) => animateIn(node, { y: 6, delay: Math.min(i, 10) * 0.03 }));
}

/** Counts a number up from 0 (used for dashboard figures later). */
export async function countUp(node, value) {
  node.textContent = String(value);
  if (!value || prefersReducedMotion()) return;
  try {
    const { animate } = await import('/vendor/anime.esm.min.js');
    const counter = { n: 0 };
    animate(counter, {
      n: value,
      duration: 600,
      ease: 'outQuad',
      onUpdate: () => { node.textContent = String(Math.round(counter.n)); },
      onComplete: () => { node.textContent = String(value); },
    });
  } catch {
    /* the final number is already shown */
  }
}

/** Short message at the bottom of the screen, read out by screen readers. */
export function toast(message, kind = 'info') {
  let region = $('#toast-region');
  if (!region) {
    region = el('div', { id: 'toast-region', class: 'toast-region', role: 'status', 'aria-live': 'polite' });
    document.body.append(region);
  }
  const node = el('div', { class: `toast toast--${kind}`, text: message });
  region.append(node);
  animateIn(node, { y: 12 });
  setTimeout(() => node.remove(), kind === 'error' ? 7000 : 4000);
}

/** "Nothing here yet" box with an optional action button. */
export function emptyState(title, hint, action) {
  return el('div', { class: 'empty' }, el('strong', { text: title }), hint ? el('p', { text: hint }) : null, action || null);
}

/** Plain-language error box with an optional "Try again" (NFR-11). */
export function errorState(err, retry) {
  return el(
    'div',
    { class: 'empty', role: 'alert' },
    el('strong', { text: err.message || 'Something went wrong.' }),
    retry ? el('button', { type: 'button', class: 'btn btn-secondary', onclick: retry, text: 'Try again' }) : null,
  );
}

/**
 * Shows the server's validation errors next to each field (UI-04), or one
 * message at the top of the form when no field is to blame. Clears old ones first.
 */
export function showFieldErrors(form, fields = {}, message) {
  form.querySelectorAll('.field-error, .form-alert').forEach((node) => node.remove());
  form.querySelectorAll('[aria-invalid]').forEach((node) => {
    node.removeAttribute('aria-invalid');
    const rest = (node.getAttribute('aria-describedby') || '').split(' ').filter((id) => !id.endsWith('-error')).join(' ');
    if (rest) node.setAttribute('aria-describedby', rest);
    else node.removeAttribute('aria-describedby');
  });

  let first = null;
  for (const [name, text] of Object.entries(fields)) {
    const input = form.elements[name];
    const inputs = input instanceof RadioNodeList ? [...input] : [input];
    if (!inputs[0]) continue;
    const id = `${name}-error`;
    (inputs[0].closest('.field') || inputs[0].parentElement).append(el('p', { class: 'field-error', id, text }));
    for (const i of inputs) {
      i.setAttribute('aria-invalid', 'true');
      i.setAttribute('aria-describedby', [i.getAttribute('aria-describedby'), id].filter(Boolean).join(' '));
    }
    first ??= inputs[0];
  }
  if (message && !first) {
    const alert = el('div', { class: 'form-alert', role: 'alert', text: message });
    form.prepend(alert);
    alert.scrollIntoView({ block: 'nearest' });
  }
  first?.focus();
}

/** Disables a button and shows a spinner while `fn` runs, so a form is not sent twice. */
export async function withBusy(button, fn) {
  const original = [...button.childNodes];
  button.disabled = true;
  button.replaceChildren(el('span', { class: 'spinner', 'aria-hidden': 'true' }), 'Sending…');
  try {
    return await fn();
  } finally {
    button.disabled = false;
    button.replaceChildren(...original);
  }
}

/** Previous / next buttons for a paged list (UI-07). Returns null when everything fits on one page. */
export function pagination({ page, pageSize, total }, onChange) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  return el(
    'nav',
    { class: 'pagination', 'aria-label': 'Pages' },
    el('button', { type: 'button', class: 'btn btn-secondary', disabled: page <= 1, onclick: () => onChange(page - 1), text: '← Previous' }),
    el('span', { class: 'muted small', text: `Page ${page} of ${pages}` }),
    el('button', { type: 'button', class: 'btn btn-secondary', disabled: page >= pages, onclick: () => onChange(page + 1), text: 'Next →' }),
  );
}
