import { CONFIG } from '../config.js';

const priceFormatter = new Intl.NumberFormat(CONFIG.currency.locale, {
  style: 'currency',
  currency: CONFIG.currency.code,
  maximumFractionDigits: 0,
});

export const formatPrice = (value) => priceFormatter.format(value).replace(/\s/g, '');

/** Número de referencia con ceros a la izquierda: 3 → "003". */
export const pad = (n, size = 3) => String(n).padStart(size, '0');
