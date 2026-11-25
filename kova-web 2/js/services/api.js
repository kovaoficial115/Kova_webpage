/**
 * Llamadas públicas al servidor de la tienda (funciones de Supabase, ver supabase/migrations/).
 * Solo usa la clave PÚBLICA: precios, descuentos, cupos y estados se calculan en el servidor.
 * Los errores pensados para el cliente llegan como "KOVA:<mensaje>" y se muestran tal cual.
 */
import { CONFIG } from '../config.js';

const B = CONFIG.backend ?? {};
export const isBackendReady = () => Boolean(B.supabaseUrl && B.supabaseAnonKey);
const base = () => B.supabaseUrl.replace(/\/$/, '');

export const publicHeaders = () => (B.supabaseAnonKey.startsWith('eyJ')
  ? { apikey: B.supabaseAnonKey, Authorization: `Bearer ${B.supabaseAnonKey}` }
  : { apikey: B.supabaseAnonKey });

export class ApiError extends Error {
  constructor(message, { friendly = false, status = 0 } = {}) { super(message); this.friendly = friendly; this.status = status; }
}

/** Mensaje claro para el cliente a partir de cualquier error. */
export function errorText(err) {
  if (err?.friendly) return err.message;
  if (err?.name === 'AbortError') return 'La conexión está lenta. Revisa tu internet e inténtalo de nuevo.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(String(err?.message))) return 'No hay conexión. Revisa tu internet e inténtalo de nuevo.';
  return 'Algo salió mal. Inténtalo de nuevo en unos segundos.';
}

/** Llama una función pública (rpc). Lanza ApiError con mensaje amable si el servidor lo indica. */
export async function rpc(fn, args = {}, { timeoutMs = 15000 } = {}) {
  if (!isBackendReady()) throw new ApiError('La tienda no está conectada a su base de datos.', { friendly: true });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${base()}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: { ...publicHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(args),
      cache: 'no-store',
      signal: ctrl.signal,
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (!res.ok) {
      const msg = String(data?.message ?? '');
      if (msg.startsWith('KOVA:')) throw new ApiError(msg.slice(5), { friendly: true, status: res.status });
      throw new ApiError(msg || `HTTP ${res.status}`, { status: res.status });
    }
    return data;
  } finally {
    clearTimeout(timer);
  }
}

/** Sube un archivo a una ruta reservada por el servidor (bucket privado de comprobantes). */
export async function uploadToReservedPath(bucket, path, file) {
  const res = await fetch(`${base()}/storage/v1/object/${bucket}/${path.split('/').map(encodeURIComponent).join('/')}`, {
    method: 'POST',
    headers: { ...publicHeaders(), Authorization: `Bearer ${B.supabaseAnonKey}`, 'Content-Type': file.type || 'application/octet-stream', 'x-upsert': 'false' },
    body: file,
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    if (res.status === 413 || /too large|maximum/i.test(body)) throw new ApiError('El archivo es demasiado pesado (máximo 8 MB).', { friendly: true });
    if (/mime/i.test(body)) throw new ApiError('Formato no permitido. Sube una imagen o un PDF.', { friendly: true });
    throw new ApiError('No se pudo subir el archivo. Inténtalo de nuevo.', { friendly: true });
  }
}

/** Huella SHA-256 del archivo (evita registrar el mismo comprobante dos veces). */
export async function sha256Hex(file) {
  const buf = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Identificador aleatorio de alta entropía (para que un doble clic no cree dos pedidos). */
export const randomKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), (b) => b.toString(16).padStart(2, '0')).join('');
