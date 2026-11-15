/**
 * FR-16 / FR-17: a resident reports a problem. The server attaches the resident
 * and the unit; the resident only picks a unit when they live in more than one.
 */
import { api } from '../api.js';
import { $, el, replace } from '../dom.js';
import { CATEGORY_LABELS } from '../format.js';
import { initLayout } from '../layout.js';
import { animateIn, emptyState, errorState, showFieldErrors, withBusy } from '../ui.js';

const card = $('#content');
const form = $('#request-form');

try {
  const user = await initLayout({ active: 'newRequest' });
  if (user?.role !== 'resident') {
    replace(card, emptyState('Only residents can report problems.', 'Choose a resident in the “Viewing as” menu to try this page.'));
  } else {
    const { items: units } = await api.get('/maintenance/my-units');

    replace(
      form.category,
      el('option', { value: '', text: 'Choose a category' }),
      Object.entries(CATEGORY_LABELS).map(([value, text]) => el('option', { value, text })),
    );
    if (units.length > 1) {
      $('#unit-field').hidden = false;
      replace(
        form.unitId,
        el('option', { value: '', text: 'Choose your apartment' }),
        units.map((u) => el('option', { value: String(u.id), text: `${u.unitNumber} (${u.occupancyType})` })),
      );
    }

    $('#loading').remove();
    form.hidden = false;
    if (units.length === 0) showFieldErrors(form, {}, 'You have no active apartment linked to your account. Please contact the building office.');
    animateIn(card);

    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const body = Object.fromEntries(new FormData(form));
      if (units.length <= 1) delete body.unitId; // the server fills in the only unit
      await withBusy(form.querySelector('button[type="submit"]'), async () => {
        try {
          const created = await api.post('/maintenance/requests', body);
          location.href = `/request.html?id=${created.id}&new=1`;
        } catch (err) {
          showFieldErrors(form, err.fields, err.message);
        }
      });
    });
  }
} catch (err) {
  replace(card, errorState(err, () => location.reload()));
}
