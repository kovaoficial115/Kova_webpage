/**
 * Verificador anti-bots (Cloudflare Turnstile) del checkout.
 * Pide un token justo antes de registrar el pedido; el servidor (create_order) lo confirma con
 * Cloudflare. La clave del sitio es PÚBLICA por diseño; la secreta vive solo en Supabase.
 * Sin `CONFIG.turnstile.siteKey` no se carga nada y el pedido sigue como antes.
 * A casi todos los compradores no les muestra nada; solo si Cloudflare duda aparece una casilla.
 */
import { CONFIG } from '../config.js';
import { ApiError } from './api.js';

const SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
const siteKey = () => CONFIG.turnstile?.siteKey || '';
const FAIL = 'No pudimos confirmar que eres una persona. Recarga la página e inténtalo de nuevo.';
let loading = null;
let widget = null;

function load() {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SRC;
    s.async = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('turnstile')));
    s.onerror = () => { loading = null; reject(new Error('turnstile')); };
    document.head.append(s);
  });
  return loading;
}

export const isCaptchaOn = () => Boolean(siteKey());

/** Empieza a cargar el verificador en segundo plano (al abrir el checkout). */
export function preloadCaptcha() { if (isCaptchaOn()) load().catch(() => {}); }

/**
 * Devuelve un token nuevo (cada token sirve una sola vez). `box` es donde aparece la casilla si
 * Cloudflare necesita que la persona confirme. Sin clave configurada devuelve ''.
 */
export async function captchaToken(box, { timeoutMs = 60000 } = {}) {
  if (!isCaptchaOn()) return '';
  let ts;
  try { ts = await load(); } catch { throw new ApiError('No cargó la verificación de seguridad. Revisa tu conexión y recarga la página.', { friendly: true }); }
  if (widget !== null) { try { ts.remove(widget); } catch { /* ya no existe */ } widget = null; }
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (fn, v) => { if (settled) return; settled = true; clearTimeout(timer); fn(v); };
    const timer = setTimeout(() => finish(reject, new ApiError(FAIL, { friendly: true })), timeoutMs);
    widget = ts.render(box, {
      sitekey: siteKey(),
      action: 'checkout',
      appearance: 'interaction-only',
      language: 'es',
      callback: (token) => finish(resolve, token),
      'error-callback': () => { finish(reject, new ApiError(FAIL, { friendly: true })); return true; },
      'expired-callback': () => finish(reject, new ApiError(FAIL, { friendly: true })),
    });
  });
}
