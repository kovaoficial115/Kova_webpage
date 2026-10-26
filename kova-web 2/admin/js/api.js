/**
 * Acceso del panel a Supabase: sesión, productos e imágenes.
 *
 * Seguridad: este archivo solo conoce la clave PÚBLICA (anon). Lo que impide que alguien sin permiso
 * cree, edite o borre productos son las reglas de la base (RLS) y del almacenamiento definidas en
 * supabase/schema.sql: toda escritura exige una sesión iniciada cuyo usuario esté en public.admins.
 */
import { CONFIG } from '../../js/config.js';
import { rowToProduct, productToRow } from '../../js/services/remoteCatalog.js';

const B = CONFIG.backend ?? {};
export const isConfigured = () => Boolean(B.supabaseUrl && B.supabaseAnonKey);

let client = null;
export function db() {
  if (!client) {
    client = window.supabase.createClient(B.supabaseUrl, B.supabaseAnonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'kova.admin.auth' },
    });
  }
  return client;
}

/** Traduce errores técnicos a mensajes claros. */
export function friendlyError(err) {
  const msg = String(err?.message ?? err ?? '');
  if (/Invalid login credentials/i.test(msg)) return 'Correo o contraseña incorrectos.';
  if (/Email not confirmed/i.test(msg)) return 'Confirma tu correo antes de entrar (revisa tu bandeja).';
  if (/duplicate key|23505|already exists/i.test(msg)) return 'Ya existe un producto con ese identificador.';
  if (/row-level security|permission denied|42501|Unauthorized|403/i.test(msg)) return 'Tu cuenta no tiene permiso para hacer esto. Vuelve a iniciar sesión como administrador.';
  if (/JWT|session/i.test(msg)) return 'Tu sesión expiró. Inicia sesión de nuevo.';
  if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) return 'No hay conexión con la base de datos. Revisa tu internet e inténtalo de nuevo.';
  if (/Payload too large|exceeded the maximum/i.test(msg)) return 'La imagen es demasiado pesada (máximo 5 MB).';
  if (/mime type|invalid_mime/i.test(msg)) return 'Formato de imagen no permitido. Usa JPG, PNG, WebP o SVG.';
  return msg || 'Ocurrió un error inesperado.';
}

const unwrap = ({ data, error }) => {
  if (error) throw error;
  return data;
};

/* ---------- Sesión ---------- */
export const getSession = async () => unwrap(await db().auth.getSession()).session;
export const signIn = async (email, password) => unwrap(await db().auth.signInWithPassword({ email, password }));
export const signOut = () => db().auth.signOut();
export const onAuthChange = (fn) => db().auth.onAuthStateChange((event, session) => fn(event, session));
export const sendPasswordReset = async (email) =>
  unwrap(await db().auth.resetPasswordForEmail(email, { redirectTo: location.href.split('#')[0] }));
export const updatePassword = async (password) => unwrap(await db().auth.updateUser({ password }));
export const isAdmin = async () => Boolean(unwrap(await db().rpc('is_admin')));

/* ---------- Productos ---------- */
export async function listProducts() {
  const rows = unwrap(await db().from(B.table).select('*').order('position', { ascending: true }).order('created_at', { ascending: true }));
  return rows.map((row) => ({ ...rowToProduct(row), position: row.position, updatedAt: row.updated_at }));
}

export async function createProduct(product, position) {
  return rowToProduct(unwrap(await db().from(B.table).insert(productToRow(product, position)).select().single()));
}

export async function updateProduct(id, product, position) {
  const row = productToRow(product, position);
  delete row.id;                          // el identificador no cambia al editar
  const data = unwrap(await db().from(B.table).update(row).eq('id', id).select());
  if (!data.length) throw new Error('permission denied: el producto no se actualizó');
  return rowToProduct(data[0]);
}

export async function setPublished(id, published) {
  const data = unwrap(await db().from(B.table).update({ published }).eq('id', id).select('id'));
  if (!data.length) throw new Error('permission denied: el producto no se actualizó');
}

export async function deleteProduct(id) {
  const data = unwrap(await db().from(B.table).delete().eq('id', id).select('id'));
  if (!data.length) throw new Error('permission denied: el producto no se eliminó');
}

/** Importa productos (forma de products.js) que aún no existen en la base. */
export async function importProducts(list, startPosition = 0) {
  if (!list.length) return 0;
  const rows = list.map((p, i) => productToRow({ ...p, published: true }, startPosition + i));
  unwrap(await db().from(B.table).upsert(rows, { onConflict: 'id', ignoreDuplicates: true }));
  return rows.length;
}

/* ---------- Imágenes ---------- */
const bucket = () => db().storage.from(B.bucket);
const publicPrefix = () => `${B.supabaseUrl.replace(/\/$/, '')}/storage/v1/object/public/${B.bucket}/`;

/** ¿La URL es un archivo de nuestro almacenamiento (y no una imagen del repositorio)? */
export const isStoredImage = (url) => typeof url === 'string' && url.startsWith(publicPrefix());

const extFor = (type) => ({ 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/png': 'png', 'image/svg+xml': 'svg', 'image/gif': 'gif', 'image/avif': 'avif' })[type] ?? 'img';

/** Sube una imagen y devuelve su URL pública permanente. */
export async function uploadImage(productId, blob) {
  const rand = Math.random().toString(36).slice(2, 8);
  const path = `${productId}/${Date.now()}-${rand}.${extFor(blob.type)}`;
  unwrap(await bucket().upload(path, blob, { contentType: blob.type, cacheControl: '31536000', upsert: false }));
  return bucket().getPublicUrl(path).data.publicUrl;
}

/** Borra imágenes de nuestro almacenamiento (ignora rutas del repositorio). */
export async function removeImages(urls) {
  const paths = urls.filter(isStoredImage).map((u) => decodeURIComponent(u.slice(publicPrefix().length)));
  if (paths.length) unwrap(await bucket().remove(paths));
}
