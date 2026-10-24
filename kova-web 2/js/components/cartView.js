/**
 * Piezas del carrito compartidas por el panel flotante (cartPanel.js) y la página carrito.html:
 * líneas de producto, resumen, formulario del comprador, validación y aviso de compra iniciada.
 * Todas leen y escriben el mismo estado (services/cart.js).
 */
import { CONFIG } from '../config.js';
import { getCart, changeQty, removeItem, clearCart, getBuyer, setBuyer, clearBuyer, validateBuyer, getPayment } from '../services/cart.js';
import { buildOrderMessage, copyText, startInstagramCheckout } from '../services/contact.js';
import { productUrl } from './productCard.js';
import { formatPrice, pad } from '../utils/format.js';
import { esc, toast } from '../utils/dom.js';

export const unitsLabel = (n) => `${pad(n, 2)} ${n === 1 ? 'unidad' : 'unidades'}`;

const variantText = (l) => [l.size && `Talla ${l.size}`, l.color && `Color ${l.color}`].filter(Boolean).join(' · ');
const lineLabel = (l) => [l.name, variantText(l).toLowerCase()].filter(Boolean).join(', ');

function lineHtml(l, max) {
  const variant = variantText(l);
  return `
    <li class="cart-line" data-key="${esc(l.key)}">
      <a class="cart-line__media" href="${productUrl({ id: l.id })}" tabindex="-1" aria-hidden="true">
        <img src="${esc(l.image)}" alt="" width="160" height="200" loading="lazy">
      </a>
      <div class="cart-line__info">
        <a class="cart-line__name" href="${productUrl({ id: l.id })}">${esc(l.name)}</a>
        ${variant ? `<span class="cart-line__variant">${esc(variant)}</span>` : ''}
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

export const summaryHtml = (cart) => `
  <dl class="cart-sum">
    <div><dt>Total de unidades</dt><dd>${cart.units}</dd></div>
    <div><dt>Subtotal</dt><dd>${formatPrice(cart.subtotal)}</dd></div>
    <div class="cart-sum__total"><dt>Total</dt><dd>${formatPrice(cart.total)}</dd></div>
  </dl>`;

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
         <span class="pay-detail__label">${esc(p.detail)} ${esc(p.label)}</span>
         <strong class="pay-detail__key">${esc(p.key)}</strong>
         <span>${esc(p.hint ?? '')}</span>
         <button class="pay-detail__link" type="button" data-copy-key="${esc(p.key)}">Copiar llave</button>
       </div>`;
  return `<div class="pay-detail${p.qr ? ' pay-detail--qr' : ''}">${body}</div>`;
}

// Copiar la llave bancaria (en el formulario y en el aviso final).
document.addEventListener('click', async (e) => {
  const btn = e.target.closest('[data-copy-key]');
  if (!btn) return;
  const ok = await copyText(btn.dataset.copyKey);
  toast(ok ? `Llave ${btn.dataset.copyKey} copiada.` : `No se pudo copiar. La llave es ${btn.dataset.copyKey}.`);
});

/** Formulario del comprador. `prefix` evita ids repetidos si hay más de un formulario en la página. */
export const buyerFormHtml = (prefix) => `
  <form class="buyer" id="${prefix}-form" novalidate data-buyer>
    <p class="cart-label">Datos del comprador</p>
    <div class="field">
      <label class="field__label" for="${prefix}-name">Nombre completo <span aria-hidden="true">*</span></label>
      <input class="field__input" id="${prefix}-name" name="name" type="text" autocomplete="name" required maxlength="80"
        placeholder="Nombre y apellido" aria-describedby="${prefix}-name-error">
      <p class="field__error" id="${prefix}-name-error"></p>
    </div>
    <div class="field">
      <label class="field__label" for="${prefix}-phone">Teléfono de contacto <span aria-hidden="true">*</span></label>
      <input class="field__input" id="${prefix}-phone" name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="20"
        placeholder="300 123 4567" aria-describedby="${prefix}-phone-error">
      <p class="field__error" id="${prefix}-phone-error"></p>
    </div>
    <fieldset class="field pay" data-payment aria-describedby="${prefix}-payment-error">
      <legend class="field__label">Método de pago <span aria-hidden="true">*</span></legend>
      <div class="pay__options">
        ${CONFIG.payments.map((p) => `
          <label class="pay__option">
            <input type="radio" name="payment" value="${esc(p.id)}" required>
            <span><strong>${esc(p.label)}</strong><small>${esc(p.detail)}</small></span>
          </label>`).join('')}
      </div>
      <p class="field__error" id="${prefix}-payment-error"></p>
      <div data-payment-detail></div>
    </fieldset>
    <p class="checkout-state" data-checkout-state aria-live="polite"></p>
  </form>`;

const FIELD_NAMES = { name: 'nombre completo', phone: 'teléfono', payment: 'método de pago' };

/**
 * Conecta un contenedor con el carrito: botones de cantidad/eliminar, formulario y finalizar compra.
 * `onCheckoutStart` se llama justo antes de mostrar el aviso (p. ej. para cerrar el panel).
 */
export function bindCart(root, { onCheckoutStart } = {}) {
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

  const form = root.querySelector('[data-buyer]');
  if (!form) return { refresh() {} };
  const touched = new Set();
  let submitted = false;

  const fill = () => {
    const buyer = getBuyer();
    form.elements.name.value = buyer.name;
    form.elements.phone.value = buyer.phone;
    form.querySelectorAll('[name="payment"]').forEach((r) => { r.checked = r.value === buyer.payment; });
    showPaymentDetail();
  };

  const showPaymentDetail = () => {
    form.querySelector('[data-payment-detail]').innerHTML = paymentDetailHtml(getPayment(getBuyer().payment));
  };

  const showErrors = (errors, fields) => {
    fields.forEach((f) => {
      const input = f === 'payment' ? form.querySelector('[data-payment]') : form.elements[f];
      const msg = errors[f] ?? '';
      input.setAttribute('aria-invalid', String(Boolean(msg)));
      input.closest('.field').classList.toggle('is-error', Boolean(msg));
      form.querySelector(`#${input.getAttribute('aria-describedby')}`).textContent = msg;
    });
  };

  /** Muestra el estado del pedido: carrito vacío, formulario incompleto o listo para finalizar. */
  const refresh = () => {
    const cart = getCart();
    const { ok, errors } = validateBuyer(getBuyer());
    const state = form.querySelector('[data-checkout-state]');
    const visible = submitted ? Object.keys(errors) : [...touched].filter((f) => errors[f]);
    showErrors(errors, submitted ? Object.keys(FIELD_NAMES) : [...touched]);
    let text;
    let tone;
    if (!cart.lines.length) { text = 'Agrega al menos una camiseta para finalizar.'; tone = 'off'; }
    else if (ok) { text = 'Pedido listo para finalizar por Instagram.'; tone = 'on'; }
    else if (submitted && visible.length) { text = `Falta completar: ${Object.keys(errors).map((f) => FIELD_NAMES[f]).join(' y ')}.`; tone = 'error'; }
    else { text = 'Completa tus datos y elige cómo pagar para finalizar.'; tone = 'off'; }
    state.textContent = text;
    state.className = `checkout-state status status--${tone === 'on' ? 'on' : 'off'}${tone === 'error' ? ' is-error' : ''}`;
  };

  form.addEventListener('input', (e) => {
    if (!e.target.name) return;
    setBuyer({ [e.target.name]: e.target.value });
    if (e.target.name === 'payment') { touched.add('payment'); showPaymentDetail(); }
    // Los errores solo aparecen en campos ya visitados; al corregirlos se actualizan en vivo.
    refresh();
  });
  form.addEventListener('focusout', (e) => {
    if (!e.target.name || !e.target.value.trim()) return;
    touched.add(e.target.name);
    refresh();
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    submitted = true;
    const cart = getCart();
    const { ok, errors, buyer } = validateBuyer(getBuyer());
    refresh();
    if (!cart.lines.length) return toast('Tu carrito está vacío.');
    if (!ok) {
      const first = Object.keys(errors)[0];
      (first === 'payment' ? form.querySelector('[name="payment"]') : form.elements[first]).focus();
      return;
    }
    const message = buildOrderMessage(cart, buyer);
    const submitters = document.querySelectorAll(`[form="${form.id}"][type="submit"], #${form.id} [type="submit"]`);
    submitters.forEach((b) => b.setAttribute('aria-busy', 'true'));
    const result = await startInstagramCheckout(message);
    submitters.forEach((b) => b.removeAttribute('aria-busy'));
    onCheckoutStart?.();
    showCheckoutNotice({ message, payment: buyer.payment, ...result });
  });

  fill();
  refresh();
  return { refresh, fill };
}

/* ---------- Aviso de compra iniciada ----------
 * Se reutiliza el diseño del modal de contacto. Nunca dice que el pedido se envió:
 * el cliente tiene que pegarlo y enviarlo en Instagram. */
let notice;

function createNotice() {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal s-navy checkout-notice';
  dialog.setAttribute('aria-labelledby', 'checkout-title');
  dialog.innerHTML = `
    <div class="modal__panel grid-lines">
      <button class="modal__close" type="button" data-close aria-label="Cerrar"><span></span><span></span></button>
      <p class="eyebrow">Compra iniciada</p>
      <h2 class="modal__title" id="checkout-title">Falta un<br>paso<span class="dot">.</span></h2>
      <ol class="notice-steps">
        <li data-step-open></li>
        <li data-step-copy></li>
        <li>Envía el mensaje. Kova te confirmará disponibilidad y envío; después paga y comparte el comprobante en el chat.</li>
      </ol>
      <div class="notice-pay" data-notice-pay></div>
      <p class="notice-warning"><i class="ico ico--destellos" aria-hidden="true"></i> Tu pedido aún no está enviado ni confirmado.</p>

      <div class="modal__message notice-message">
        <label class="modal__label" for="checkout-text">Mensaje del pedido</label>
        <textarea id="checkout-text" class="notice-message__text" readonly rows="8"></textarea>
        <button class="btn btn--line btn--sm btn--block" type="button" data-copy>Copiar mensaje</button>
      </div>

      <a class="btn btn--primary btn--xl btn--block modal__cta" href="${CONFIG.instagram.contactUrl}" target="_blank" rel="noopener" data-open>
        Ir al chat de Instagram <span class="btn__arrow" aria-hidden="true">↗</span>
      </a>
      <button class="notice-clear" type="button" data-clear>Ya envié mi pedido: vaciar carrito</button>
    </div>`;
  document.body.append(dialog);

  const close = () => {
    dialog.classList.add('is-closing');
    setTimeout(() => { dialog.classList.remove('is-closing'); dialog.close(); }, 220);
  };
  dialog.querySelector('[data-close]').addEventListener('click', close);
  dialog.addEventListener('click', (e) => e.target === dialog && close());
  dialog.addEventListener('close', () => document.body.classList.remove('no-scroll'));

  const area = dialog.querySelector('textarea');
  area.addEventListener('focus', () => area.select());
  dialog.querySelector('[data-copy]').addEventListener('click', async (e) => {
    const ok = await copyText(area.value);
    if (!ok) { area.focus(); area.select(); }
    e.currentTarget.textContent = ok ? 'Mensaje copiado' : 'Selecciona el texto y cópialo';
    toast(ok ? 'Mensaje copiado. Pégalo en el chat de Instagram.' : 'No se pudo copiar: selecciona el texto y cópialo.');
  });
  dialog.querySelector('[data-open]').addEventListener('click', () => copyText(area.value));
  dialog.querySelector('[data-clear]').addEventListener('click', () => {
    clearCart();
    clearBuyer();
    close();
    toast('Carrito vacío. ¡Gracias por escribirle a Kova!');
  });
  return dialog;
}

export function showCheckoutNotice({ message, payment, copied, opened }) {
  notice ??= createNotice();
  const handle = `@${CONFIG.instagram.handle}`;
  notice.querySelector('[data-step-open]').textContent = opened
    ? `Abrimos el chat de ${handle} en una pestaña nueva.`
    : `Abre el chat de ${handle} con el botón de abajo.`;
  notice.querySelector('[data-step-copy]').textContent = copied
    ? 'Copiamos tu pedido: pégalo en el chat de Instagram.'
    : 'No pudimos copiar el mensaje automáticamente: cópialo desde el recuadro de abajo y pégalo en el chat.';
  notice.classList.toggle('is-copy-failed', !copied);
  notice.querySelector('[data-notice-pay]').innerHTML = payment
    ? `<p class="modal__label">Cómo pagar: ${esc(payment.label)}</p>${paymentDetailHtml(payment)}`
    : '';
  notice.querySelector('textarea').value = message;
  notice.querySelector('[data-copy]').textContent = copied ? 'Copiar de nuevo' : 'Copiar mensaje';
  if (!notice.open) notice.showModal();
  document.body.classList.add('no-scroll');
  if (!copied) {
    const area = notice.querySelector('textarea');
    area.focus();
    area.select();
  }
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
