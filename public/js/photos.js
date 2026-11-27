/**
 * BR-19: photo checks and previews for every form with a photo field (reporting a
 * problem, progress notes). Quick feedback only: the server checks every file again.
 */
import { el, replace } from './dom.js';
import { showFieldErrors } from './ui.js';

const MAX_FILES = 3;
const MAX_BYTES = 5 * 1024 * 1024;
const TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** A message for the first problem with the chosen photos, or null. `max` is how many still fit. */
export function photoProblem(files, max = MAX_FILES) {
  if (files.length > max) return `You can attach up to ${max} photo${max === 1 ? '' : 's'}.`;
  for (const f of files) {
    if (!TYPES.includes(f.type)) return `"${f.name}" is not a JPG, PNG or WEBP photo.`;
    if (f.size > MAX_BYTES) return `"${f.name}" is larger than 5 MB.`;
  }
  return null;
}

/** Shows small previews (or the problem, next to the field) whenever the chosen photos change. */
export function watchPhotos(form, input, preview) {
  let urls = [];
  input.addEventListener('change', () => {
    const files = [...input.files];
    const problem = photoProblem(files, Number(input.dataset.max) || MAX_FILES);
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = problem ? [] : files.map((f) => URL.createObjectURL(f));
    replace(preview, urls.map((src, i) => el('img', { src, alt: files[i].name })));
    showFieldErrors(form, problem ? { [input.name]: problem } : {});
  });
}

/** Puts the chosen photos into `data` (FormData). An empty file input would otherwise send a blank file. */
export function appendPhotos(data, input) {
  data.delete(input.name);
  for (const f of input.files) data.append(input.name, f);
}

/**
 * A labelled photo field with hint and preview area, for forms built in JavaScript.
 * `max`: how many photos still fit (BR-19 counts all photos of a request).
 */
export { MAX_FILES };

export function photoField(id, max = MAX_FILES) {
  const input = el('input', { id, name: 'photos', type: 'file', accept: TYPES.join(','), multiple: true, 'aria-describedby': `${id}-hint`, 'data-max': max });
  const preview = el('div', { class: 'photos' });
  const field = el(
    'div',
    { class: 'field' },
    el('label', { for: id }, 'Photos ', el('span', { class: 'muted small', text: '(optional)' })),
    el('p', { class: 'hint', id: `${id}-hint`, text: `Up to ${max} ${max < MAX_FILES ? 'more ' : ''}photo${max === 1 ? '' : 's'} (${MAX_FILES} per request). JPG, PNG or WEBP, 5 MB each.` }),
    input,
    preview,
  );
  return { field, input, preview };
}
