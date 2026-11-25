/**
 * Estado público de la tienda que viene del servidor (get_storefront):
 *   - campañas de preventa (fase real, fechas, anticipo, cupos si la campaña decide mostrarlos)
 *   - opciones de envío y textos legales editables desde /admin.
 *
 * Igual que el catálogo: si el servidor no responde se usa la última copia guardada. Con una copia
 * vieja la tienda puede mostrar una preventa, pero NUNCA confirma nada: el servidor valida todo al
 * crear el pedido.
 */
import { isBackendReady, rpc } from './api.js';

const SNAPSHOT_KEY = 'kova.storefront.snapshot.v1';
let state = { campaigns: [], shipping: {}, legal: {}, now: new Date().toISOString(), source: 'none' };
let clockSkew = 0; // diferencia entre el reloj del servidor y el del navegador

async function load() {
  if (!isBackendReady()) return;
  try {
    const data = await rpc('get_storefront', {}, { timeoutMs: 6000 });
    state = { ...state, ...data, source: 'remote' };
    clockSkew = new Date(data.now).getTime() - Date.now();
    try { localStorage.setItem(SNAPSHOT_KEY, JSON.stringify({ at: Date.now(), data })); } catch { /* sin almacenamiento */ }
  } catch (err) {
    console.warn('[Kova] No se pudo leer el estado de preventas; se usa la copia guardada.', err);
    try {
      const snap = JSON.parse(localStorage.getItem(SNAPSHOT_KEY) || 'null');
      if (snap?.data) state = { ...state, ...snap.data, source: 'snapshot' };
    } catch { /* copia dañada */ }
  }
}

export const storefrontReady = load();

/** Hora del servidor (evita contadores falsos si el reloj del teléfono está mal). */
export const serverNow = () => Date.now() + clockSkew;

export const getCampaigns = () => state.campaigns ?? [];
export const getShippingOptions = () => {
  const opts = (state.shipping?.options ?? []).filter((o) => o.active !== false);
  return opts.length ? opts : [{ id: 'coordinar', label: 'Envío nacional (costo a confirmar por WhatsApp)', cost: null, requires_address: true }];
};
export const getLegal = () => state.legal ?? {};
export const maxUnitsPerLine = () => state.max_units_per_line ?? 10;

/** Fase vigente calculada con la hora del servidor: scheduled | open | paused | sold_out | closed. */
export function livePhase(c) {
  if (!c) return null;
  const now = serverNow();
  if (c.phase === 'paused' || c.phase === 'archived' || c.phase === 'draft') return c.phase;
  if (c.closes_at && now >= Date.parse(c.closes_at)) return 'closed';
  if (c.phase === 'closed') return 'closed';
  if (c.opens_at && now < Date.parse(c.opens_at)) return 'scheduled';
  if (c.phase === 'sold_out' || c.remaining === 0) return 'sold_out';
  return 'open';
}

/** Campaña en la que participa un producto (o null). */
export function campaignFor(productId) {
  return getCampaigns().find((c) => c.products?.some((p) => p.product_id === productId)) ?? null;
}

/** Datos de preventa de un producto: { campaign, phase, remaining, variantInfo(size,color) } o null. */
export function preorderInfo(product) {
  if (product?.saleMode !== 'preorder') return null;
  const campaign = campaignFor(product.id);
  if (!campaign) return { campaign: null, phase: 'closed', remaining: null, variantInfo: () => ({ enabled: false, remaining: null }) };
  const entry = campaign.products.find((p) => p.product_id === product.id);
  const remainingProduct = entry?.remaining ?? null;
  const variantInfo = (size, color) => {
    const v = entry?.variants?.find((x) => x.size === (size ?? '') && x.color === (color ?? ''));
    return { enabled: v ? v.enabled !== false : true, remaining: v?.remaining ?? null };
  };
  const remaining = [campaign.remaining, remainingProduct].filter((n) => Number.isInteger(n));
  return { campaign, phase: livePhase(campaign), remaining: remaining.length ? Math.min(...remaining) : null, variantInfo };
}

/** Valor mínimo de reserva (anticipo) con el mismo redondeo del servidor: peso entero, mitad hacia arriba. */
export const depositOf = (price, pct) => Math.round((price * pct) / 100);
