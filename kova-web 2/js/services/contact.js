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

/** Mensaje del pedido completo, a partir del estado actual del carrito (precios del catálogo). */
export function buildOrderMessage(cart, buyer) {
  const items = cart.lines.map((l, i) => [
    `${i + 1}. ${l.name}`,
    l.size ? `Talla: ${l.size}` : null,
    l.color ? `Color: ${l.color}` : null,
    `Cantidad: ${l.qty}`,
    `Precio unitario: ${formatPrice(l.unitPrice)}`,
    `Subtotal: ${formatPrice(l.subtotal)}`,
  ].filter(Boolean).join('\n')).join('\n\n');

  return [
    'Hola, Kova. ¡Quiero realizar el siguiente pedido!',
    '',
    'DATOS DEL COMPRADOR',
    `Nombre: ${buyer.name}`,
    `Teléfono: ${buyer.phone}`,
    '',
    'MÉTODO DE PAGO',
    `${buyer.payment.label} — ${buyer.payment.detail}${buyer.payment.key ? ` ${buyer.payment.key}` : ''}`,
    '',
    'MI PEDIDO',
    '',
    items,
    '',
    'RESUMEN',
    `Total de unidades: ${cart.units}`,
    `Subtotal: ${formatPrice(cart.subtotal)}`,
    `Total del pedido: ${formatPrice(cart.total)}`,
    '',
    'Quedo atento/a para confirmar la disponibilidad y los detalles de mi pedido. ¡Gracias!',
  ].join('\n');
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
