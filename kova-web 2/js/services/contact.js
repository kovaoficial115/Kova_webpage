/**
 * Contacto y compra por WhatsApp.
 * - Mensaje de un producto (consultas, p. ej. reposición de un agotado).
 * - Mensaje del pedido completo del carrito y apertura del chat de WhatsApp con el texto ya escrito.
 */
import { CONFIG } from '../config.js';
import { formatPrice } from '../utils/format.js';
import { productUrl } from '../components/productCard.js';

export function buildContactMessage(product, size) {
  const url = new URL(productUrl(product), window.location.href).href;
  return CONFIG.contactMessage
    .replace('{name}', product.name)
    .replace('{size}', size ? ` — talla ${size}` : '')
    .replace('{price}', formatPrice(product.price))
    .replace('{url}', url);
}

/* ---------- Pedido del carrito ---------- */

/** Número de pedido legible: KV-251122-7F3A (fecha + 4 caracteres aleatorios). */
export function newOrderId(date = new Date()) {
  const ymd = [date.getFullYear() % 100, date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, '0')).join('');
  const rand = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'[b % 32]).join('');
  return `KV-${ymd}-${rand}`;
}

const FACE_NAME = { front: 'FRENTE', back: 'ESPALDA' };

/**
 * Archivos que el cliente debe adjuntar en WhatsApp: uno por cada cara estampada de cada
 * personalización, numerados por producto para que KOVA sepa cuál es cuál.
 */
export function attachmentsFor(cart) {
  const out = [];
  cart.lines.forEach((l, i) => {
    if (!l.custom) return;
    l.zones.forEach((z) => out.push({
      product: i + 1,
      face: z.face,
      faceName: FACE_NAME[z.face],
      label: `Producto ${i + 1} · ${FACE_NAME[z.face]}`,
      zone: `${z.label} — ${z.measures}`,
      file: l.files?.[z.face] ?? '',
    }));
  });
  return out;
}

/**
 * Mensaje del pedido completo (precios vigentes del catálogo y de KOVA CUSTOM).
 * Usa *negrita* de WhatsApp. Nunca dice que los archivos se enviaron: el cliente los adjunta.
 */
export function buildOrderMessage(cart, buyer, orderId) {
  const customLines = cart.lines.filter((l) => l.custom);
  const customUnits = customLines.reduce((n, l) => n + l.qty, 0);
  const hasCustom = customLines.length > 0;
  const files = attachmentsFor(cart);

  const blocks = cart.lines.map((l, i) => {
    const head = cart.lines.length > 1 ? `*Producto ${i + 1}: ${l.custom ? 'KOVA CUSTOM' : l.name}*` : null;
    const rows = l.custom
      ? [
        `- Modalidad: ${l.mode.name} (${l.mode.label})`,
        `- Color: ${l.color}`,
        `- Talla: ${l.size}`,
        `- Estampado delantero: ${l.front}`,
        `- Estampado trasero: ${l.back}`,
        `- Cantidad: ${l.qty}`,
        `- Precio: ${formatPrice(l.unitPrice)}`,
        `- Total: ${formatPrice(l.subtotal)}`,
      ]
      : [
        cart.lines.length > 1 ? null : `- Producto: ${l.name}`,
        l.color ? `- Color: ${l.color}` : null,
        l.size ? `- Talla: ${l.size}` : null,
        `- Cantidad: ${l.qty}`,
        `- Precio: ${formatPrice(l.unitPrice)}`,
        `- Total: ${formatPrice(l.subtotal)}`,
      ];
    return [head, ...rows].filter(Boolean).join('\n');
  });

  const intro = hasCustom
    ? (customUnits > 1 || customLines.length > 1
      ? 'Hola, quiero realizar camisetas personalizadas.'
      : 'Hola, quiero realizar una camiseta personalizada.')
    : 'Hola, Kova. Quiero realizar el siguiente pedido.';

  const lines = [
    hasCustom ? '*KOVA CUSTOM — NUEVO PEDIDO*' : '*KOVA — NUEVO PEDIDO*',
    '',
    intro,
    '',
    '*Datos del pedido:*',
    `- Número de pedido: ${orderId}`,
    cart.lines.length > 1 ? `- Productos: ${cart.lines.length} (${cart.units} unidades)` : null,
    '',
    blocks.join('\n\n'),
  ];
  if (cart.lines.length > 1) lines.push('', `*TOTAL DEL PEDIDO: ${formatPrice(cart.total)}*`);

  lines.push(
    '',
    '*Datos del comprador:*',
    `- Nombre: ${buyer.name}`,
    `- Teléfono: ${buyer.phone}`,
    `- Método de pago: ${buyer.payment.label} — ${buyer.payment.detail}${buyer.payment.key ? ` ${buyer.payment.key}` : ''}`,
  );

  if (hasCustom) {
    const two = files.some((f) => f.face === 'front') && files.some((f) => f.face === 'back');
    lines.push(
      '',
      two
        ? 'Voy a adjuntar mis diseños originales para realizar el estampado: el archivo del FRENTE y el de la ESPALDA.'
        : 'Voy a adjuntar mi diseño original para realizar el estampado.',
      '*Archivos que adjuntaré en este chat:*',
      ...files.map((f) => `- ${f.label} (${f.zone})${f.file ? `: «${f.file}»` : ''}`),
    );
  }

  lines.push('', 'Quedo atento/a a la confirmación del pedido y del pago. ¡Gracias!');
  return lines.filter((l) => l !== null).join('\n');
}

/** Copia texto al portapapeles. Usa la API moderna y, si no existe, el método clásico. */
export async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return true; } catch { /* sigue al método clásico */ }
  }
  try {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.style.cssText = 'position:fixed;top:0;left:0;opacity:0;pointer-events:none';
    document.body.append(area);
    area.select();
    const ok = document.execCommand('copy');
    area.remove();
    return ok;
  } catch {
    return false;
  }
}

/** Enlace al WhatsApp de Kova, con el mensaje ya escrito si se pasa uno. */
export const whatsappUrl = (message = '') =>
  `https://wa.me/${CONFIG.whatsapp.number}${message ? `?text=${encodeURIComponent(message)}` : ''}`;

/**
 * Inicia la compra: abre el WhatsApp de Kova con el pedido ya escrito.
 * Además copia el mensaje, por si la app no lo muestra escrito (respaldo).
 * La pestaña se abre en el mismo clic para que el navegador no la bloquee.
 * Devuelve { copied, opened }. El pedido NO queda enviado: el cliente debe pulsar enviar en WhatsApp.
 */
export async function startWhatsAppCheckout(message) {
  const copying = copyText(message);
  const win = window.open(whatsappUrl(message), '_blank');
  if (win) win.opener = null;
  return { copied: await copying, opened: Boolean(win) };
}
