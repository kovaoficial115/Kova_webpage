/**
 * Carrito de Kova: un único estado compartido por el botón flotante, el panel,
 * la cabecera y la página carrito.html.
 *
 * - Se guarda en localStorage solo lo mínimo: [{ id, size, color, qty }].
 *   Nombre, imagen y precio se leen SIEMPRE del catálogo, nunca de lo guardado.
 * - Cada variante (camiseta + talla + color) es una línea distinta.
 * - Los datos del comprador viven en sessionStorage: se borran al cerrar la pestaña.
 * - KOVA CUSTOM usa este mismo carrito: cada personalización es una línea propia
 *   { id: 'kova-custom', ref, mode, color, size, qty, files, place }. Su precio, color y talla se
 *   validan SIEMPRE contra la configuración vigente (services/custom.js). Los diseños no se guardan:
 *   solo el nombre del archivo (para recordar cuál enviar por WhatsApp) y una miniatura pequeña.
 */
import { CONFIG } from '../config.js';
import { getProductById, isAvailable } from './catalog.js';
import { getPayments } from './settings.js';
import { CUSTOM_PRODUCT_ID } from '../data/custom.js';
import { getMode, getColor, validateCustom, stockOf, priceOf, faceText, modeMeasures, modeZones, cmText } from './custom.js';
import { teeDataUrl } from '../components/teeMockup.js';

const KEY = CONFIG.cart.storageKey;
const BUYER_KEY = `${KEY}.buyer`;
const THUMBS_KEY = `${KEY}.thumbs`;
const MAX = CONFIG.cart.maxQtyPerItem;

const listeners = new Set();

export const isCustomLine = (it) => it?.id === CUSTOM_PRODUCT_ID;

export const lineKey = (it) => (isCustomLine(it)
  ? [CUSTOM_PRODUCT_ID, it.ref].join('::')
  : [it.id, it.size ?? '', it.color ?? ''].join('::'));

/** Máximo de unidades de una línea: el general del carrito o el inventario de KOVA CUSTOM. */
function maxFor(it) {
  if (!isCustomLine(it)) return MAX;
  const stock = stockOf(it.color, it.size);
  return stock === null ? MAX : Math.min(MAX, stock);
}

/** Una línea es válida si el producto existe, está disponible y la talla/color existen y no están agotados. */
function isValidLine(line) {
  if (isCustomLine(line)) return typeof line.ref === 'string' && !validateCustom(line);
  const { id, size, color } = line;
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

const clampQty = (n, max = MAX) => Math.min(max, Math.max(1, Math.floor(Number(n)) || 1));

const cleanFiles = (files) => {
  const out = {};
  ['front', 'back'].forEach((f) => { if (typeof files?.[f] === 'string' && files[f]) out[f] = files[f].slice(0, 120); });
  return out;
};
const cleanPlace = (place) => {
  const out = {};
  ['front', 'back'].forEach((f) => {
    const p = place?.[f];
    if (p && Number.isFinite(p.w) && Number.isFinite(p.h)) out[f] = { w: Math.round(p.w * 10) / 10, h: Math.round(p.h * 10) / 10 };
  });
  return out;
};

/** Copia mínima y segura de una línea guardada. */
function pick(it) {
  if (isCustomLine(it)) {
    return { id: CUSTOM_PRODUCT_ID, ref: String(it.ref ?? ''), mode: it.mode, color: it.color, size: it.size, files: cleanFiles(it.files), place: cleanPlace(it.place) };
  }
  return { id: it.id, size: it.size ?? null, color: it.color ?? null };
}

/** Lee el carrito guardado, descarta lo que ya no existe y une líneas repetidas. */
function sanitize(raw) {
  const merged = new Map();
  (Array.isArray(raw) ? raw : []).forEach((it) => {
    if (!it || typeof it.id !== 'string') return;
    const line = pick(it);
    if (!isValidLine(line)) return;
    const key = lineKey(line);
    const prev = merged.get(key)?.qty ?? 0;
    merged.set(key, { ...line, qty: clampQty(prev + clampQty(it.qty), maxFor(line)) });
  });
  return [...merged.values()];
}

function load() {
  try { return sanitize(JSON.parse(localStorage.getItem(KEY) || '[]')); } catch { return []; }
}

let items = load();

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(items)); } catch { /* modo privado: el carrito vive solo en memoria */ }
  pruneThumbs();
}

/* ---------- Miniaturas de KOVA CUSTOM (solo en este navegador) ---------- */
function readThumbs() {
  try { return JSON.parse(localStorage.getItem(THUMBS_KEY) || '{}') || {}; } catch { return {}; }
}
function writeThumbs(map) {
  try { localStorage.setItem(THUMBS_KEY, JSON.stringify(map)); } catch { /* sin espacio: se usa el dibujo de la camiseta */ }
}
function pruneThumbs() {
  const map = readThumbs();
  const refs = new Set(items.filter(isCustomLine).map((it) => it.ref));
  const next = Object.fromEntries(Object.entries(map).filter(([ref]) => refs.has(ref)));
  if (Object.keys(next).length !== Object.keys(map).length) writeThumbs(next);
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
  const thumbs = items.some(isCustomLine) ? readThumbs() : {};
  const lines = items.map((it) => {
    if (isCustomLine(it)) {
      const mode = getMode(it.mode);
      const color = getColor(it.color);
      const unitPrice = priceOf(it.mode);
      return {
        key: lineKey(it),
        id: it.id,
        custom: true,
        ref: it.ref,
        size: it.size,
        color: color.name,
        colorId: color.id,
        qty: it.qty,
        max: maxFor(it),
        name: `KOVA CUSTOM — ${mode.name}`,
        mode: { id: mode.id, name: mode.name, label: mode.label, measures: modeMeasures(mode) },
        front: faceText(mode, 'front'),
        back: faceText(mode, 'back'),
        zones: modeZones(mode).map((z) => ({ face: z.face, label: z.label, measures: cmText(z) })),
        files: it.files ?? {},
        place: it.place ?? {},
        image: thumbs[it.ref] || teeDataUrl(modeZones(mode)[0].face, color.hex),
        url: 'custom.html',
        unitPrice,
        subtotal: unitPrice * it.qty,
      };
    }
    const product = getProductById(it.id);
    return {
      key: lineKey(it),
      id: it.id,
      size: it.size,
      color: it.color,
      qty: it.qty,
      max: MAX,
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

/**
 * Agrega una personalización de KOVA CUSTOM como línea nueva.
 * `files` = nombres de los archivos elegidos para previsualizar (frente/espalda); `thumb` = miniatura
 * opcional (data URL pequeña) que se guarda solo en este navegador.
 * Devuelve { ok, error?, qty, capped }.
 */
export function addCustomItem({ mode, color, size, qty = 1, files = {}, place = {}, thumb = '' } = {}) {
  const ref = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const line = { id: CUSTOM_PRODUCT_ID, ref, mode, color, size, files: cleanFiles(files), place: cleanPlace(place) };
  const error = validateCustom(line);
  if (error) return { ok: false, error };
  const max = maxFor(line);
  const wanted = clampQty(qty, Infinity);
  const next = Math.min(max, wanted);
  if (thumb && thumb.length < 120000) writeThumbs({ ...readThumbs(), [ref]: thumb });
  commit([...items, { ...line, qty: next }]);
  return { ok: true, qty: next, capped: wanted > max, max };
}

export function setQty(key, qty) {
  const n = Math.floor(Number(qty));
  if (!Number.isFinite(n)) return;
  if (n < 1) return removeItem(key);
  commit(items.map((it) => (lineKey(it) === key ? { ...it, qty: clampQty(n, maxFor(it)) } : it)));
}

export const changeQty = (key, delta) => {
  const it = items.find((i) => lineKey(i) === key);
  if (it) setQty(key, it.qty + delta);
};

export const removeItem = (key) => commit(items.filter((it) => lineKey(it) !== key));
export const clearCart = () => commit([]);

/* ---------- Datos del comprador (solo durante la sesión de la pestaña) ---------- */
export function getBuyer() {
  try { return { name: '', phone: '', payment: '', ...JSON.parse(sessionStorage.getItem(BUYER_KEY) || '{}') }; } catch { return { name: '', phone: '', payment: '' }; }
}
export function setBuyer(patch) {
  const next = { ...getBuyer(), ...patch };
  try { sessionStorage.setItem(BUYER_KEY, JSON.stringify({ name: next.name, phone: next.phone, payment: next.payment })); } catch { /* sin almacenamiento */ }
  return next;
}
export function clearBuyer() {
  try { sessionStorage.removeItem(BUYER_KEY); } catch { /* sin almacenamiento */ }
}

/** Método de pago elegido (de los ajustes del panel o de CONFIG.payments), o undefined. */
export const getPayment = (id) => getPayments().find((p) => p.id === id);

/** Valida nombre, teléfono y método de pago. Devuelve { ok, errors: { name?, phone?, payment? }, buyer }. */
export function validateBuyer({ name = '', phone = '', payment = '' }) {
  const cleanName = name.trim().replace(/\s+/g, ' ');
  const digits = phone.replace(/[\s().-]/g, '');
  const errors = {};
  if (!cleanName) errors.name = 'Escribe tu nombre completo.';
  else if (cleanName.split(' ').filter((w) => w.length >= 2).length < 2 || /[\d@]/.test(cleanName)) errors.name = 'Escribe tu nombre y apellido.';
  if (!digits) errors.phone = 'Escribe un número de contacto.';
  else if (!/^\+?\d{7,15}$/.test(digits)) errors.phone = 'Escribe un teléfono válido: solo números, entre 7 y 15 dígitos.';
  if (!getPayment(payment)) errors.payment = 'Elige un método de pago.';
  return { ok: !Object.keys(errors).length, errors, buyer: { name: cleanName, phone: phone.trim(), payment: getPayment(payment) } };
}

// Otra pestaña cambió el carrito: se recarga para que todo coincida.
addEventListener('storage', (e) => {
  if (e.key !== KEY) return;
  items = load();
  emit();
});
