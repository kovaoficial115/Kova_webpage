/**
 * Diseños de KOVA CUSTOM guardados en ESTE navegador (IndexedDB) entre "Agregar al carrito" y el
 * registro del pedido. Al registrarlo, la página del pedido los sube al bucket privado de KOVA
 * (con el enlace privado del pedido) y los borra de aquí.
 *
 * Si el navegador no permite IndexedDB (modo privado antiguo), nada falla: el cliente sube sus
 * diseños directamente desde la página del pedido.
 */
const DB = 'kova-designs';
const STORE = 'files';
const MAX_AGE_MS = 14 * 24 * 3600 * 1000;

let dbPromise = null;
function open() {
  if (!('indexedDB' in globalThis)) return Promise.reject(new Error('sin IndexedDB'));
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'key' }).createIndex('ref', 'ref');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  }).catch((err) => { dbPromise = null; throw err; });
  return dbPromise;
}

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const out = fn(t.objectStore(STORE));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

/** Guarda los archivos de una personalización: files = { front?: File, back?: File }. */
export async function saveDesigns(ref, files) {
  try {
    await tx('readwrite', (s) => {
      Object.entries(files).forEach(([face, file]) => {
        if (file instanceof Blob) s.put({ key: `${ref}:${face}`, ref, face, name: file.name || `${face}.png`, type: file.type, blob: file, at: Date.now() });
      });
    });
    return true;
  } catch { return false; }
}

/** Archivos guardados de una personalización: { front?: File, back?: File }. */
export async function getDesigns(ref) {
  try {
    const rows = await tx('readonly', (s) => s.index('ref').getAll(ref));
    const out = {};
    (rows ?? []).forEach((r) => { out[r.face] = new File([r.blob], r.name, { type: r.type || r.blob.type }); });
    return out;
  } catch { return {}; }
}

export async function removeDesign(ref, face) {
  try { await tx('readwrite', (s) => s.delete(`${ref}:${face}`)); } catch { /* nada que borrar */ }
}

export async function removeDesigns(ref) {
  try { await tx('readwrite', (s) => { ['front', 'back'].forEach((f) => s.delete(`${ref}:${f}`)); }); } catch { /* nada que borrar */ }
}

/** Borra lo que tenga más de 14 días (pedidos abandonados), para no ocupar espacio del dispositivo. */
export async function pruneOldDesigns() {
  try {
    const rows = await tx('readonly', (s) => s.getAll());
    const old = (rows ?? []).filter((r) => Date.now() - r.at > MAX_AGE_MS).map((r) => r.key);
    if (old.length) await tx('readwrite', (s) => old.forEach((k) => s.delete(k)));
  } catch { /* sin almacenamiento */ }
}
