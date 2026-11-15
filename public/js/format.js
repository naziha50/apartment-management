/**
 * Display names for the fixed lists in
 * server/modules/maintenance/maintenance.constants.js (FR-16).
 */
export const CATEGORY_LABELS = {
  plumbing: 'Plumbing',
  electrical: 'Electrical',
  lift: 'Lift',
  generator: 'Generator',
  water_supply: 'Water supply',
  gas: 'Gas',
  cleaning: 'Cleaning',
  security: 'Security',
  common_area: 'Common area',
  other: 'Other',
};

export const categoryLabel = (c) => CATEGORY_LABELS[c] || c;
