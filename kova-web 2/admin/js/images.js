/**
 * Prepara las fotos antes de subirlas: las reduce a un máximo de 1600 px de ancho y las convierte
 * a WebP (o JPG si el navegador no sabe crear WebP), para que la tienda cargue rápido.
 * SVG y GIF se suben tal cual.
 */
const MAX_SIDE = 1600;
const MAX_INPUT = 25 * 1024 * 1024;       // 25 MB antes de optimizar
export const MAX_UPLOAD = 5 * 1024 * 1024; // 5 MB ya optimizada (límite del almacenamiento)
export const ACCEPT = 'image/jpeg,image/png,image/webp,image/avif,image/gif,image/svg+xml';

const loadBitmap = (file) => new Promise((resolve, reject) => {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => resolve({ img, url });
  img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la imagen. ¿Es un archivo de imagen válido?')); };
  img.src = url;
});

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** Devuelve un Blob listo para subir o lanza un Error con un mensaje claro. */
export async function prepareImage(file) {
  if (!file.type.startsWith('image/') || !ACCEPT.split(',').includes(file.type)) {
    throw new Error(`«${file.name}» no es un formato permitido. Usa JPG, PNG, WebP o SVG.`);
  }
  if (file.size > MAX_INPUT) throw new Error(`«${file.name}» pesa más de 25 MB.`);
  if (file.type === 'image/svg+xml' || file.type === 'image/gif') {
    if (file.size > MAX_UPLOAD) throw new Error(`«${file.name}» pesa más de 5 MB.`);
    return file;
  }
  const { img, url } = await loadBitmap(file);
  try {
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
    let blob = await toBlob(canvas, 'image/webp', 0.86);
    if (!blob || blob.type !== 'image/webp') blob = await toBlob(canvas, 'image/jpeg', 0.88);
    if (!blob) throw new Error(`No se pudo procesar «${file.name}».`);
    // Si optimizar no ayudó (ya venía liviana), se sube el original.
    const out = blob.size < file.size ? blob : file;
    if (out.size > MAX_UPLOAD) throw new Error(`«${file.name}» sigue pesando más de 5 MB después de optimizarla.`);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
