/**
 * Textos alternativos de las imágenes de producto, generados a partir de los datos del producto
 * (nombre, categoría, descripción y nombre del archivo). Así toda imagen nueva, también las que se
 * suben desde el panel /admin, tiene un texto alternativo útil sin escribirlo a mano.
 */
import { categories } from '../data/categories.js';

const VIEWS = [
  [/(back|espalda|posterior|trasera|reverso)/i, 'vista de la espalda'],
  [/(front|frente|frontal|delantera)/i, 'vista frontal'],
  [/(detail|detalle|macro|zoom)/i, 'detalle'],
  [/(model|modelo|puesta|lifestyle)/i, 'puesta'],
];

/** Vista que muestra una imagen según su nombre de archivo, o null si no se puede saber. */
export function imageView(src = '') {
  const file = String(src).split(/[?#]/)[0].split('/').pop();
  return VIEWS.find(([re]) => re.test(file))?.[1] ?? null;
}

/** "Camiseta" para la categoría shirts (campo `item` de categories.js; si falta, nada). */
const itemNoun = (product) => categories.find((c) => c.id === product.category)?.item ?? '';

/** Primera frase de la descripción, sin punto final y sin pasar de ~140 caracteres. */
function firstSentence(text = '') {
  const s = String(text).trim().split(/(?<=[.!?])\s/)[0].replace(/[.!?\s]+$/, '');
  if (s.length <= 140) return s;
  return `${s.slice(0, 140).replace(/\s+\S*$/, '')}…`;
}

/**
 * Texto alternativo para la imagen `index` de un producto.
 * La principal lleva además la descripción visual; las demás dicen qué vista son.
 *   productAlt(p, 0) → "Camiseta Cyber Star Tee, vista frontal. Camiseta azul marino oversize con destellos…"
 *   productAlt(p, 1) → "Camiseta Cyber Star Tee, vista de la espalda"
 * Con { short: true } solo nombre y vista (miniaturas junto al nombre ya escrito).
 */
export function productAlt(product, index = 0, { short = false } = {}) {
  if (!product) return '';
  const images = product.images ?? [];
  const noun = itemNoun(product);
  const name = noun && !product.name.toLowerCase().startsWith(noun.toLowerCase())
    ? `${noun} ${product.name}` : product.name;
  const view = imageView(images[index]) ?? (images.length > 1 ? `imagen ${index + 1} de ${images.length}` : '');
  const head = view ? `${name}, ${view}` : name;
  const detail = index === 0 && !short ? firstSentence(product.description) : '';
  return detail ? `${head}. ${detail}` : head;
}
