/**
 * Ajustes de la tienda que se administran desde /admin y ven TODOS los clientes:
 *   - 'custom'    KOVA CUSTOM: modalidades, precios, zonas, colores, tallas, inventario e imágenes.
 *   - 'contact'   Número de WhatsApp Business que recibe los pedidos.
 *   - 'payments'  Métodos de pago (Llave Nu, Nequi…).
 *
 * Se leen de Supabase (tabla store_settings, lectura pública con la clave anon). Si la base no
 * responde, se usa la última copia guardada en el navegador y, si no hay, los valores iniciales
 * (js/data/custom.js y js/config.js). WhatsApp y pagos se aplican sobre CONFIG para que todo el
 * sitio (pie, contacto, carrito) use siempre los mismos datos.
 *
 * catalog.js espera `settingsReady` junto con los productos, antes de pintar cualquier página.
 */
import { CONFIG } from '../config.js';
import { customDefaults } from '../data/custom.js';

const B = CONFIG.backend ?? {};
const SNAPSHOT_KEY = 'kova.settings.snapshot.v1';
const TABLE = B.settingsTable || 'store_settings';

const clone = (v) => JSON.parse(JSON.stringify(v));
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);
const str = (v, fallback = '') => (typeof v === 'string' ? v.trim() : fallback);
const bool = (v, fallback = true) => (typeof v === 'boolean' ? v : fallback);
const slug = (v) => str(v).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

/* ---------- Normalización (la usan también el panel y las pruebas) ---------- */

/** Limpia una configuración de KOVA CUSTOM y completa lo que falte con los valores iniciales. */
export function normalizeCustom(raw) {
  const d = clone(customDefaults);
  if (!raw || typeof raw !== 'object') return d;

  const zones = Array.isArray(raw.zones) && raw.zones.length ? raw.zones : d.zones;
  const out = {
    zones: zones.map((z, i) => ({
      id: slug(z.id) || `zona-${i + 1}`,
      label: str(z.label) || `Zona ${i + 1}`,
      face: z.face === 'back' ? 'back' : 'front',
      widthCm: Math.max(1, num(z.widthCm, 10)),
      heightCm: Math.max(1, num(z.heightCm, 10)),
      x: Math.min(100, Math.max(0, num(z.x, 50))),
      y: Math.min(100, Math.max(0, num(z.y, 20))),
    })),
  };
  const zoneIds = new Set(out.zones.map((z) => z.id));

  out.modes = (Array.isArray(raw.modes) ? raw.modes : d.modes).map((m, i) => ({
    id: slug(m.id) || `modo-${i + 1}`,
    name: str(m.name) || `CUSTOM ${i + 1}`,
    label: str(m.label),
    zones: (Array.isArray(m.zones) ? m.zones : []).filter((z) => zoneIds.has(z)),
    price: Math.max(0, Math.round(num(m.price, 0))),
    active: bool(m.active),
  })).filter((m) => m.zones.length);

  out.colors = (Array.isArray(raw.colors) ? raw.colors : d.colors).map((c, i) => ({
    id: slug(c.id) || slug(c.name) || `color-${i + 1}`,
    name: str(c.name) || `Color ${i + 1}`,
    hex: /^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#141414',
    active: bool(c.active),
    images: { front: str(c.images?.front), back: str(c.images?.back) },
  }));

  out.sizes = (Array.isArray(raw.sizes) ? raw.sizes : d.sizes)
    .map((s) => (typeof s === 'string' ? { id: s, active: true } : { id: str(s.id), active: bool(s.active) }))
    .filter((s) => s.id);

  out.inventory = {};
  const inv = raw.inventory && typeof raw.inventory === 'object' ? raw.inventory : {};
  Object.entries(inv).forEach(([color, bySize]) => {
    if (!bySize || typeof bySize !== 'object') return;
    Object.entries(bySize).forEach(([size, n]) => {
      if (n === null || n === '' || n === undefined) return;
      const v = Math.max(0, Math.floor(Number(n)));
      if (Number.isFinite(v)) (out.inventory[color] ??= {})[size] = v;
    });
  });

  const cm = raw.mockup?.cmPerWidth ?? {};
  out.mockup = { cmPerWidth: { front: Math.max(20, num(cm.front, d.mockup.cmPerWidth.front)), back: Math.max(20, num(cm.back, d.mockup.cmPerWidth.back)) } };

  const up = raw.upload ?? {};
  out.upload = {
    maxMb: Math.min(100, Math.max(1, num(up.maxMb, d.upload.maxMb))),
    minDpi: Math.max(30, num(up.minDpi, d.upload.minDpi)),
    goodDpi: Math.max(60, num(up.goodDpi, d.upload.goodDpi)),
  };
  return out;
}

/** WhatsApp: solo dígitos con indicativo (57…). Devuelve null si no es válido. */
export function normalizeContact(raw) {
  const number = String(raw?.whatsapp?.number ?? '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(number)) return null;
  return { number, display: str(raw.whatsapp.display) || `+${number}` };
}

export function normalizePayments(raw) {
  if (!Array.isArray(raw)) return null;
  const list = raw.map((p, i) => ({
    id: slug(p.id) || slug(p.label) || `pago-${i + 1}`,
    label: str(p.label),
    detail: str(p.detail),
    key: str(p.key),
    holder: str(p.holder),
    hint: str(p.hint),
    qr: str(p.qr),
    active: bool(p.active),
  })).filter((p) => p.label && (p.key || p.qr));
  // Sin campos vacíos, para que la tienda los trate igual que los de config.js.
  return list.map((p) => Object.fromEntries(Object.entries(p).filter(([, v]) => v !== '')));
}

/* ---------- Carga ---------- */

const publicHeaders = () => (B.supabaseAnonKey.startsWith('eyJ')
  ? { apikey: B.supabaseAnonKey, Authorization: `Bearer ${B.supabaseAnonKey}` }
  : { apikey: B.supabaseAnonKey });

async function fetchRemote() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), B.timeoutMs ?? 6000);
  try {
    const res = await fetch(`${B.supabaseUrl.replace(/\/$/, '')}/rest/v1/${TABLE}?select=key,value`, {
      headers: publicHeaders(), cache: 'no-store', signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Ajustes: HTTP ${res.status}`);
    const rows = await res.json();
    if (!Array.isArray(rows)) throw new Error('Ajustes: respuesta inesperada');
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  } finally {
    clearTimeout(timer);
  }
}

let custom = normalizeCustom(null);
let source = 'local';

function apply(map) {
  custom = normalizeCustom(map.custom);
  const contact = normalizeContact(map.contact);
  if (contact) CONFIG.whatsapp = contact;
  const payments = normalizePayments(map.payments);
  if (payments?.length) CONFIG.payments = payments;
}

async function load() {
  CONFIG.payments = normalizePayments(CONFIG.payments);
  if (!(B.supabaseUrl && B.supabaseAnonKey)) return;
  try {
    const map = await fetchRemote();
    apply(map);
    source = 'remote';
    try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), map })); } catch { /* sin almacenamiento */ }
  } catch (err) {
    console.warn('[Kova] No se pudieron leer los ajustes en línea; se usa la copia de respaldo.', err);
    try {
      const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
      if (snap?.map) { apply(snap.map); source = 'snapshot'; }
    } catch { /* copia dañada: valores iniciales */ }
  }
}

/** Promesa que se cumple cuando los ajustes ya están aplicados (nunca falla). */
export const settingsReady = load();

export const getCustomConfig = () => custom;
export const settingsSource = () => source;
/** Métodos de pago activos. */
export const getPayments = () => CONFIG.payments.filter((p) => p.active !== false);
