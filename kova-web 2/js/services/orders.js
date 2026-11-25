/**
 * Pedidos de este navegador: número + token privado, para volver al seguimiento desde "Mis pedidos".
 * El token solo vive en el dispositivo del cliente (localStorage); sin él no se puede ver el pedido.
 */
const KEY = 'kova.myOrders.v1';

export function myOrders() {
  try { const l = JSON.parse(localStorage.getItem(KEY) || '[]'); return Array.isArray(l) ? l.filter((o) => /^[0-9a-f]{64}$/.test(o.token)) : []; } catch { return []; }
}
export function rememberOrder({ number, token }) {
  const list = myOrders().filter((o) => o.token !== token);
  list.unshift({ number, token, at: new Date().toISOString() });
  try { localStorage.setItem(KEY, JSON.stringify(list.slice(0, 20))); } catch { /* sin almacenamiento */ }
}
export function forgetOrder(token) {
  try { localStorage.setItem(KEY, JSON.stringify(myOrders().filter((o) => o.token !== token))); } catch { /* sin almacenamiento */ }
}
export const trackingUrl = (token) => new URL(`pedido.html#${token}`, location.href).href;
