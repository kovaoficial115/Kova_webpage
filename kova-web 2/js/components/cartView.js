/**
 * Piezas del carrito compartidas por el panel flotante (cartPanel.js) y la página carrito.html:
 * líneas de producto, resumen, formulario del comprador, validación y aviso de compra iniciada.
 * Todas leen y escriben el mismo estado (services/cart.js).
 */
import { CONFIG } from '../config.js';
import { changeQty, removeItem } from '../services/cart.js';
import { copyText } from '../services/contact.js';
import { getPromo } from '../services/promo.js';
import { bindPromo, promoSummaryRows } from './promoField.js';
import { productUrl } from './productCard.js';
import { formatPrice, pad } from '../utils/format.js';
import { esc, toast } from '../utils/dom.js';

export const unitsLabel = (n) => `${pad(n, 2)} ${n === 1 ? 'unidad' : 'unidades'}`;

const variantText = (l) => [l.size && `Talla ${l.size}`, l.color && `Color ${l.color}`, l.custom && l.mode.label].filter(Boolean).join(' · ');

/** Fecha corta en hora de Colombia: "15 dic 2026". */
export const dateText = (iso) => (iso ? new Date(String(iso).length === 10 ? `${iso}T12:00:00-05:00` : iso)
  .toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'America/Bogota' }) : '');
const lineHref = (l) => (l.custom ? l.url : productUrl({ id: l.id }));
const lineLabel = (l) => [l.name, variantText(l).toLowerCase()].filter(Boolean).join(', ');

function lineHtml(l, cartMax) {
  const variant = variantText(l);
  const max = l.max ?? cartMax;
  return `
    <li class="cart-line" data-key="${esc(l.key)}">
      <a class="cart-line__media${l.custom ? ' cart-line__media--custom' : ''}" href="${lineHref(l)}" tabindex="-1" aria-hidden="true">
        <img src="${esc(l.image)}" alt="${esc(`Foto de ${l.name}`)}" width="160" height="200" loading="lazy">
      </a>
      <div class="cart-line__info">
        <a class="cart-line__name" href="${lineHref(l)}">${esc(l.name)}</a>
        ${l.kind === 'preorder' ? `<span class="cart-line__pre"><span class="tag tag--pre">Preventa</span>${l.campaign?.dispatch ? ` Despacho estimado: ${esc(dateText(l.campaign.dispatch))}` : ''}</span>` : ''}
        ${variant ? `<span class="cart-line__variant">${esc(variant)}</span>` : ''}
        ${l.custom ? `<span class="cart-line__custom">${l.zones.map((z) => `${z.face === 'front' ? 'Frente' : 'Espalda'}: ${esc(z.measures)}`).join(' · ')}<br>${l.zones.every((z) => l.files?.[z.face]) ? 'Diseño listo: se sube al registrar el pedido' : 'Diseño: lo subes al registrar el pedido'}</span>` : ''}
        <span class="cart-line__unit"><span class="cart-line__unitLabel">Precio unitario </span>${formatPrice(l.unitPrice)}</span>
      </div>
      <div class="qty" role="group" aria-label="Cantidad de ${esc(lineLabel(l))}">
        <button class="qty__btn" type="button" data-action="dec" data-key="${esc(l.key)}" aria-label="Quitar una unidad de ${esc(lineLabel(l))}"${l.qty <= 1 ? ' disabled' : ''}>−</button>
        <output class="qty__value" aria-live="polite">${l.qty}</output>
        <button class="qty__btn" type="button" data-action="inc" data-key="${esc(l.key)}" aria-label="Agregar una unidad de ${esc(lineLabel(l))}"${l.qty >= max ? ' disabled' : ''}>+</button>
      </div>
      <strong class="cart-line__subtotal"><span class="cart-line__subLabel">Subtotal </span>${formatPrice(l.subtotal)}</strong>
      <button class="cart-line__remove" type="button" data-action="remove" data-key="${esc(l.key)}" aria-label="Eliminar ${esc(lineLabel(l))} del carrito">
        <span class="cart-line__x" aria-hidden="true"></span><span class="cart-line__removeLabel">Quitar</span>
      </button>
    </li>`;
}

export const linesHtml = (cart) => cart.lines.map((l) => lineHtml(l, cart.max)).join('');

export function summaryHtml(cart) {
  const promo = getPromo();
  const disc = promo.status === 'ok' ? promo.result.discount : 0;
  const total = cart.subtotal - disc;
  const now = promo.status === 'ok' ? promo.result.quote.amount_due_now : cart.minNow;
  return `
  <dl class="cart-sum">
    <div><dt>Total de unidades</dt><dd>${cart.units}</dd></div>
    <div><dt>Subtotal</dt><dd>${formatPrice(cart.subtotal)}</dd></div>
    ${promoSummaryRows(promo)}
    <div class="cart-sum__total"><dt>Total productos</dt><dd>${formatPrice(total)}</dd></div>
    ${cart.hasPreorder ? `<div class="cart-sum__now"><dt>Para reservar pagas desde</dt><dd>${formatPrice(now)}</dd></div>` : ''}
  </dl>
  <p class="cart-sum__note">${cart.hasPreorder ? 'Incluye productos en preventa: puedes pagar un anticipo y el saldo después. ' : ''}El envío se muestra en el siguiente paso.</p>`;
}

export const emptyHtml = ({ title = 'Tu carrito está vacío', cta = 'Ver catálogo' } = {}) => `
  <div class="cart-empty">
    <i class="ico ico--orbita cart-empty__ico" aria-hidden="true"></i>
    <p class="cart-empty__title">${esc(title)}<span class="dot">.</span></p>
    <p class="cart-empty__text">Elige una camiseta y su talla para empezar tu pedido.</p>
    <a class="btn btn--primary btn--block" href="index.html#catalogo" data-continue>${esc(cta)} <span class="btn__arrow" aria-hidden="true">→</span></a>
  </div>`;

/** Datos para pagar con un método (QR de Nequi o llave bancaria). */
export function paymentDetailHtml(p) {
  if (!p) return '';
  const body = p.qr
    ? `<figure class="pay-detail__qr">
         <img src="${esc(p.qr)}" alt="Código QR de ${esc(p.label)} para pagar a ${esc(p.holder ?? CONFIG.brand.name)}" width="200" height="200" loading="lazy">
       </figure>
       <div class="pay-detail__text">
         ${p.holder ? `<strong>${esc(p.holder)}</strong>` : ''}
         <span>${esc(p.hint ?? '')}</span>
         <a class="pay-detail__link" href="${esc(p.qr)}" download="kova-${esc(p.id)}-qr.png">Guardar imagen del QR <span class="btn__arrow" aria-hidden="true">↓</span></a>
       </div>`
    : `<div class="pay-detail__text">
         <span class="pay-detail__label">Entidad: ${esc(p.label)} · Método: ${esc(p.detail)}</span>
         <strong class="pay-detail__key">${esc(p.key)}</strong>
         ${p.holder ? `<span>${esc(p.holder)}</span>` : ''}
         <span>${esc(p.hint ?? '')}</span>
         <button class="btn btn--light btn--sm pay-detail__copy" type="button" data-copy-key="${esc(p.key)}">Copiar llave <span class="btn__arrow" aria-hidden="true">⧉</span></button>
       </div>`;
  return `<div class="pay-detail${p.qr ? ' pay-detail--qr' : ''}">${body}</div>`;
}

// Copiar la llave bancaria (en el formulario y en el aviso final).
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy-key]');
  if (!btn) return;
  const ok = await copyText(btn.dataset.copyKey);
  toast(ok ? `Llave ${btn.dataset.copyKey} copiada.` : `No se pudo copiar. La llave es ${btn.dataset.copyKey}.`);
  if (ok) {
    const prev = btn.innerHTML;
    btn.textContent = 'Llave copiada ✓';
    setTimeout(() => { btn.innerHTML = prev; }, 1800);
  }
});

/** Botón para continuar a la compra (checkout.html). */
export const checkoutCtaHtml = () => `
  <a class="btn btn--primary btn--xl btn--block" href="checkout.html" data-checkout-cta>
    Continuar con la compra <i class="ico ico--destellos" aria-hidden="true"></i>
  </a>
  <p class="cart-trust"><i class="ico ico--orbita" aria-hidden="true"></i> Pago por transferencia (Llave Nu o Nequi). Tu pedido queda registrado con un número y un enlace privado de seguimiento.</p>`;

/** Conecta un contenedor con el carrito: botones de cantidad, eliminar y código promocional. */
export function bindCart(root) {
  root.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-action]');
    if (!btn || !root.contains(btn)) return;
    const { action, key } = btn.dataset;
    if (action === 'inc') changeQty(key, 1);
    if (action === 'dec') changeQty(key, -1);
    if (action === 'remove') {
      const name = btn.closest('.cart-line')?.querySelector('.cart-line__name')?.textContent ?? 'Producto';
      removeItem(key);
      toast(`${name} se quitó del carrito.`);
    }
  });
  bindPromo(root);
  return { refresh() {}, fill() {} };
}

/** Repinta una lista sin perder el foco del botón que el usuario estaba usando. */
export function renderList(list, html) {
  const active = document.activeElement;
  const focusSel = list.contains(active) && active.dataset.action
    ? `[data-action="${active.dataset.action}"][data-key="${CSS.escape(active.dataset.key)}"]`
    : null;
  const index = focusSel ? [...list.querySelectorAll('.cart-line')].indexOf(active.closest('.cart-line')) : -1;
  list.innerHTML = html;
  if (!focusSel) return;
  let target = list.querySelector(focusSel);
  if (target?.disabled) target = target.parentElement.querySelector('.qty__btn:not([disabled])');
  if (!target) {
    // La línea se eliminó: el foco pasa a la línea siguiente (o a la anterior).
    const lines = list.querySelectorAll('.cart-line');
    target = lines[Math.min(index, lines.length - 1)]?.querySelector('.cart-line__remove');
  }
  target?.focus();
  return !target;
}
