/**
 * Carrito de Kova: un único estado compartido por el botón flotante, el panel,
 * la cabecera y la página carrito.html.
 *
 * - Se guarda en localStorage solo lo mínimo: [{ id, size, color, qty }].
 *   Nombre, imagen y precio se leen SIEMPRE del catálogo, nunca de lo guardado.
 * - Cada variante (camiseta + talla + color) es una línea distinta.
 * - Los datos del comprador viven en sessionStorage: se borran al cerrar la pestaña.
 */
import { CONFIG } from '../config.js';
import { getProductById, isAvailable } from './catalog.js';

const KEY = CONFIG.cart.storageKey;
const BUYER_KEY = `${KEY}.buyer`;
const MAX = CONFIG.cart.maxQtyPerItem;

const listeners = new Set();

export const lineKey = ({ id, size = null, color = null }) => [id, size ?? '', color ?? ''].join('::');

/** Una línea es válida si el producto existe, está disponible y la talla/color existen y no están agotados. */
function isValidLine({ id, size, color }) {
  const product = getProductById(id);
  if (!product || !isAvailable(product) || !Number.isInteger(product.price) || product.price < 0) return false;
  if (product.sizes?.length) {
    if (!product.sizes.includes(size) || product.soldOutSizes?.includes(size)) return false;
  } else if (size) return false;
  if (product.colors?.length) {
    if (!product.colors.some((c) => c.name === color)) return false;
  } else if (color) return false;
  return true;
}

const clampQty = (n) => Math.min(MAX, Math.max(1, Math.floor(Number(n)) || 1));

/** Lee el carrito guardado, descarta lo que ya no existe y une líneas repetidas. */
function sanitize(raw) {
  const merged = new Map();
  (Array.isArray(raw) ? raw : []).forEach((it) => {
    if (!it || typeof it.id !== 'string') return;
    const line = { id: it.id, size: it.size ?? null, color: it.color ?? null };
    if (!isValidLine(line)) return;
    const key = lineKey(line);
    const prev = merged.get(key)?.qty ?? 0;
    merged.set(key, { ...line, qty: clampQty(prev + clampQty(it.qty)) });
  });
  return [...merged.values()];
}

function load() {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
}

let items = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* modo privado: el carrito vive solo en memoria */ }
}

function commit(next) {
  items = next;
  save();
  emit();
}

function emit() {
  const snap = getCart();
  listeners.forEach((fn) => fn(snap));
}

/** Suscribe una vista a los cambios. Devuelve la función para cancelar. */
export function subscribe(fn) {
  listeners.add(fn);
  fn(getCart());
  return () => listeners.delete(fn);
}

/** Estado listo para pintar: líneas con datos del catálogo y totales calculados en enteros (pesos). */
export function getCart() {
  const lines = items.map((it) => {
    const product = getProductById(it.id);
    return {
      key: lineKey(it),
      id: it.id,
      size: it.size,
      color: it.color,
      qty: it.qty,
      name: product.name,
      image: product.images[0],
      unitPrice: product.price,
      subtotal: product.price * it.qty,
    };
  });
  const units = lines.reduce((n, l) => n + l.qty, 0);
  const subtotal = lines.reduce((n, l) => n + l.subtotal, 0);
  // Sin envío, impuestos ni descuentos en el catálogo: el total es el subtotal.
  return { lines, units, subtotal, total: subtotal, max: MAX };
}

/** Agrega una variante. Devuelve { ok, qty, capped }. */
export function addItem(id, { size = null, color = null, qty = 1 } = {}) {
  const line = { id, size, color };
  if (!isValidLine(line)) return { ok: false };
  const key = lineKey(line);
  const existing = items.find((it) => lineKey(it) === key);
  const wanted = (existing?.qty ?? 0) + clampQty(qty);
  const next = Math.min(MAX, wanted);
  commit(existing
    ? items.map((it) => (lineKey(it) === key ? { ...it, qty: next } : it))
    : [...items, { ...line, qty: next }]);
  return { ok: true, qty: next, capped: wanted > MAX };
}

export function setQty(key, qty) {
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n)) return;
  if (n < 1) return removeItem(key);
  commit(items.map((it) => (lineKey(it) === key ? { ...it, qty: clampQty(n) } : it)));
}

export const changeQty = (key, delta) => {
  const it = items.find((i) => lineKey(i) === key);
  if (it) setQty(key, it.qty + delta);
};

export const removeItem = (key) => commit(items.filter((it) => lineKey(it) !== key));
export const clearCart = () => commit([]);

/* ---------- Datos del comprador (solo durante la sesión de la pestaña) ---------- */
export function getBuyer() {
  try { return { name: '', phone: '', ...JSON.parse(sessionStorage.getItem(BUYER_KEY) || '{}') }; } catch { return { name: '', phone: '' }; }
}
export function setBuyer(patch) {
  const next = { ...getBuyer(), ...patch };
  try { sessionStorage.setItem(BUYER_KEY, JSON.stringify({ name: next.name, phone: next.phone })); } catch { /* sin almacenamiento */ }
  return next;
}
export function clearBuyer() {
  try { sessionStorage.removeItem(BUYER_KEY); } catch { /* sin almacenamiento */ }
}

/** Valida nombre y teléfono. Devuelve { ok, errors: { name?, phone? }, buyer }. */
export function validateBuyer({ name = '', phone = '' }) {
  const cleanName = name.trim().replace(/\s+/g, ' ');
  const digits = phone.replace(/[\s().-]/g, '');
  const errors = {};
  if (!cleanName) errors.name = 'Escribe tu nombre completo.';
  else if (cleanName.split(' ').filter((w) => w.length >= 2).length < 2 || /[\d@]/.test(cleanName)) errors.name = 'Escribe tu nombre y apellido.';
  if (!digits) errors.phone = 'Escribe un número de contacto.';
  else if (!/^\+?\d{7,15}$/.test(digits)) errors.phone = 'Escribe un teléfono válido: solo números, entre 7 y 15 dígitos.';
  return { ok: !Object.keys(errors).length, errors, buyer: { name: cleanName, phone: phone.trim() } };
}

// Otra pestaña cambió el carrito: se recarga para que todo coincida.
addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  items = load();
  emit();
});
