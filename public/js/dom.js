/**
 * Small helpers for building the page safely.
 *
 * User data (names, titles, descriptions) is always inserted as text or as an
 * attribute value, never as HTML, so it cannot inject script (NFR-05).
 *
 *   el('a', { href: '/x', class: 'btn' }, 'Open')
 */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs || {})) {
    if (value == null || value === false) continue;
    if (key === 'class') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') node.addEventListener(key.slice(2).toLowerCase(), value);
    else if (value === true) node.setAttribute(key, '');
    else node.setAttribute(key, String(value));
  }
  append(node, children);
  return node;
}

function append(node, children) {
  for (const child of children.flat(Infinity)) {
    if (child == null || child === false) continue;
    node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  }
}

export const $ = (selector, root = document) => root.querySelector(selector);

/** Replaces all children of `node` with `children`. */
export function replace(node, ...children) {
  node.replaceChildren();
  append(node, children);
  return node;
}

/** Inline SVG icons (decorative unless a label is given). */
const ICONS = {
  home: 'M12 3 2 11h3v9h6v-6h2v6h6v-9h3Z',
  menu: 'M3 6h18v2H3zm0 5h18v2H3zm0 5h18v2H3z',
};

export function icon(name, label) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('fill', 'currentColor');
  if (label) {
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', label);
  } else {
    svg.setAttribute('aria-hidden', 'true');
  }
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  path.setAttribute('d', ICONS[name] || '');
  svg.append(path);
  return svg;
}
