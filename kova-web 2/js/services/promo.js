/**
 * Código promocional del carrito (uno por pedido). Estado compartido por el panel, carrito.html y el checkout.
 * Validar NO consume usos: el servidor reserva el uso al crear el pedido y lo confirma con el pago.
 * El código se vuelve a validar cada vez que cambia el carrito.
 */
import { rpc, errorText } from './api.js';
import { serverItems, cartSignature, subscribe, getBuyer, setBuyer } from './cart.js';

const listeners = new Set();
let state = { code: getBuyer().promo || '', status: 'idle', result: null, message: '', sig: '' };
let seq = 0;

const emit = () => listeners.forEach((fn) => fn(state));
const set = (patch) => { state = { ...state, ...patch }; emit(); };

export const getPromo = () => state;
export function onPromo(fn) { listeners.add(fn); fn(state); return () => listeners.delete(fn); }

/** Aplica (o vuelve a validar) un código contra el carrito actual. */
export async function applyPromo(raw, { silent = false } = {}) {
  const code = String(raw ?? '').trim().toUpperCase();
  if (!code) return removePromo();
  const items = serverItems();
  if (!items.length) return set({ code, status: 'idle', result: null, message: '' });
  const my = ++seq;
  set({ code, status: 'loading', message: silent ? state.message : 'Validando código…' });
  try {
    const b = getBuyer();
    const r = await rpc('validate_promo', { p_code: code, p_items: items, p_email: b.email || '', p_phone: b.phone || '', p_plan: b.plan || 'deposit' });
    if (my !== seq) return state;
    setBuyer({ promo: r.ok ? code : (r.requires_email ? code : '') });
    return set({ code, status: r.ok ? 'ok' : (r.requires_email ? 'pending' : 'error'), result: r.ok ? r : null, message: r.message, sig: cartSignature() });
  } catch (err) {
    if (my !== seq) return state;
    return set({ status: 'error', result: null, message: errorText(err) });
  }
}

export function removePromo() {
  seq++;
  setBuyer({ promo: '' });
  return set({ code: '', status: 'idle', result: null, message: '', sig: '' });
}

/** Texto del descuento: "10%" o "$5.000". */
export const promoValueText = (r, fmt) => (r?.discount_type === 'percent' ? `${r.percent}%` : fmt(r?.fixed_amount ?? 0));

// Si el carrito cambia con un código aplicado, se vuelve a validar (con una pequeña espera).
let timer;
subscribe(() => {
  if (!state.code || state.sig === cartSignature()) return;
  clearTimeout(timer);
  timer = setTimeout(() => applyPromo(state.code, { silent: true }), 350);
});
if (state.code) setTimeout(() => applyPromo(state.code, { silent: true }), 0);
