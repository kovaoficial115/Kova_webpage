/**
 * Piezas del carrito compartidas por el panel flotante (cartPanel.js) y la página carrito.html:
 * líneas de producto, resumen, formulario del comprador, validación y aviso de compra iniciada.
 * Todas leen y escriben el mismo estado (services/cart.js).
 */
import { CONFIG } from '../config.js';
import { getCart, changeQty, removeItem, clearCart, getBuyer, setBuyer, clearBuyer, validateBuyer, getPayment } from '../services/cart.js';
import { buildOrderMessage, copyText, whatsappUrl, newOrderId, attachmentsFor } from '../services/contact.js';
import { getPayments } from '../services/settings.js';
import { productUrl } from './productCard.js';
import { formatPrice, pad } from '../utils/format.js';
import { esc, toast } from '../utils/dom.js';

export const unitsLabel = (n) => `${pad(n, 2)} ${n === 1 ? 'unidad' : 'unidades'}`;

const variantText = (l) => [l.size && `Talla ${l.size}`, l.color && `Color ${l.color}`, l.custom && l.mode.label].filter(Boolean).join(' · ');
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
        ${variant ? `<span class="cart-line__variant">${esc(variant)}</span>` : ''}
        ${l.custom ? `<span class="cart-line__custom">${l.zones.map((z) => `${z.face === 'front' ? 'Frente' : 'Espalda'}: ${esc(z.measures)}`).join(' · ')}<br>Diseño original: se envía por WhatsApp</span>` : ''}
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

/** Aviso junto al botón de finalizar: deja claro qué pasa al pulsarlo. */
export const copyHintHtml = () => `
  <div class="copy-hint" role="note">
    <span class="copy-hint__ico" aria-hidden="true"><span></span><span></span></span>
    <p><strong>Al pulsar “Finalizar pedido” verás el resumen y el botón “Enviar pedido por WhatsApp”.</strong>
    Llega al WhatsApp de Kova (${esc(CONFIG.whatsapp.display)}) con tu pedido ya escrito. Si personalizaste camisetas, ahí mismo adjuntas tus diseños originales.</p>
  </div>`;

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
        ${getPayments().map((p) => `
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
    else if (ok) { text = 'Pedido listo: pulsa «Finalizar pedido» para ver el resumen.'; tone = 'on'; }
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
    const orderId = orderIdFor(cart);
    const message = buildOrderMessage(cart, buyer, orderId);
    onCheckoutStart?.();
    showCheckoutNotice({ message, orderId, cart, payment: buyer.payment });
  });

  fill();
  refresh();
  return { refresh, fill };
}

/* ---------- Resumen final y envío por WhatsApp ----------
 * "Finalizar pedido" abre este resumen. El botón ENVIAR PEDIDO POR WHATSAPP abre el chat de Kova
 * con el mensaje escrito. Nunca dice que el pedido o los archivos se enviaron ni que está
 * confirmado: el cliente pulsa enviar, adjunta sus diseños y Kova lo verifica. */

/** Mismo número de pedido mientras el carrito no cambie (si el cliente abre el resumen dos veces). */
const ORDER_KEY = `${CONFIG.cart.storageKey}.order`;
function orderIdFor(cart) {
  const sig = cart.lines.map((l) => `${l.key}x${l.qty}@${l.unitPrice}`).join('|');
  try {
    const saved = JSON.parse(sessionStorage.getItem(ORDER_KEY) || 'null');
    if (saved?.sig === sig && saved.id) return saved.id;
  } catch { /* sin almacenamiento */ }
  const id = newOrderId();
  try { sessionStorage.setItem(ORDER_KEY, JSON.stringify({ sig, id })); } catch { /* sin almacenamiento */ }
  return id;
}

let notice;

function createNotice() {
  const dialog = document.createElement('dialog');
  dialog.className = 'modal s-navy checkout-notice';
  dialog.setAttribute('aria-labelledby', 'checkout-title');
  dialog.innerHTML = `
    <div class="modal__panel grid-lines">
      <button class="modal__close" type="button" data-close aria-label="Cerrar"><span></span><span></span></button>
      <p class="eyebrow">Resumen del pedido · <span data-order-id></span></p>
      <h2 class="modal__title" id="checkout-title">Envíalo por<br>WhatsApp<span class="dot">.</span></h2>

      <div class="notice-files" data-files hidden>
        <p class="notice-files__title"><i class="ico ico--destellos" aria-hidden="true"></i> Tus diseños se envían por WhatsApp</p>
        <p class="notice-files__text">Para iniciar la producción necesitamos tus <b>archivos originales</b> (PNG, JPG o WEBP, en la mejor calidad que tengas). La web no los sube a ningún lado: después de enviar el mensaje, adjúntalos en el mismo chat con el clip 📎 → <i>Documento</i> (así WhatsApp no los comprime).</p>
        <ol class="notice-files__list" data-file-list></ol>
        <p class="notice-files__tip">Tip: escribe la etiqueta (por ejemplo «Producto 1 · FRENTE») en el mensaje de cada archivo para que sepamos dónde va. Una captura de la previsualización no reemplaza el archivo original.</p>
      </div>

      <ol class="notice-steps" data-steps></ol>
      <div class="notice-pay" data-notice-pay></div>
      <p class="notice-warning"><i class="ico ico--destellos" aria-hidden="true"></i> <span data-warning></span></p>

      <details class="modal__message notice-message">
        <summary class="modal__label">Ver el mensaje que se enviará</summary>
        <textarea id="checkout-text" class="notice-message__text" readonly rows="10" aria-label="Mensaje del pedido"></textarea>
        <button class="btn btn--line btn--sm btn--block" type="button" data-copy>Copiar mensaje</button>
      </details>

      <a class="btn btn--primary btn--xl btn--block modal__cta" href="${whatsappUrl()}" target="_blank" rel="noopener" data-open>
        Enviar pedido por WhatsApp <span class="btn__arrow" aria-hidden="true">↗</span>
      </a>
      <p class="notice-after" data-after hidden></p>
      <button class="notice-clear" type="button" data-clear hidden>Ya envié mi pedido y mis archivos: vaciar carrito</button>
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
    toast(ok ? 'Mensaje copiado. Pégalo en el chat de WhatsApp.' : 'No se pudo copiar: selecciona el texto y cópialo.');
  });

  // El enlace abre WhatsApp en el mismo clic (sin bloqueos de ventanas). Además se copia el mensaje.
  dialog.querySelector('[data-open]').addEventListener('click', async () => {
    const copied = await copyText(area.value);
    const hasFiles = !dialog.querySelector('[data-files]').hidden;
    const after = dialog.querySelector('[data-after]');
    after.hidden = false;
    after.innerHTML = `<b>Abrimos WhatsApp con tu pedido escrito.</b> Pulsa enviar en el chat${hasFiles ? ' y luego adjunta tus archivos originales como se indica arriba' : ''}.
      ${copied ? 'Si el mensaje no aparece escrito, pégalo: ya lo copiamos.' : 'Si el mensaje no aparece escrito, cópialo desde «Ver el mensaje».'}
      ¿No se abrió? Vuelve a pulsar el botón.`;
    dialog.querySelector('[data-clear]').hidden = false;
    dialog.querySelector('.modal__cta').firstChild.textContent = 'Abrir WhatsApp de nuevo ';
  });
  dialog.querySelector('[data-clear]').addEventListener('click', () => {
    clearCart();
    clearBuyer();
    try { sessionStorage.removeItem(ORDER_KEY); } catch { /* sin almacenamiento */ }
    close();
    toast('Carrito vacío. Kova revisará tu mensaje y te confirmará por WhatsApp.');
  });
  return dialog;
}

export function showCheckoutNotice({ message, orderId, cart, payment }) {
  notice ??= createNotice();
  const files = attachmentsFor(cart);
  const wa = `el WhatsApp de Kova (${CONFIG.whatsapp.display})`;
  notice.querySelector('[data-order-id]').textContent = orderId;

  const filesBox = notice.querySelector('[data-files]');
  filesBox.hidden = !files.length;
  notice.querySelector('[data-file-list]').innerHTML = files.map((f) => `
    <li class="notice-file notice-file--${f.face}">
      <span class="notice-file__tag">${esc(f.label)}</span>
      <span class="notice-file__zone">${esc(f.zone)}</span>
      <span class="notice-file__name">${f.file ? `Archivo que previsualizaste: <b>${esc(f.file)}</b>` : 'Adjunta aquí tu archivo original'}</span>
    </li>`).join('');

  const steps = [
    `Pulsa «Enviar pedido por WhatsApp»: se abre ${wa} con este resumen escrito. Revísalo y pulsa enviar.`,
    files.length ? 'En el mismo chat adjunta tus diseños originales (uno por cada cara indicada arriba).' : null,
    'Kova revisa el mensaje' + (files.length ? ' y tus archivos' : '') + ', te confirma disponibilidad y envío, y te indica cuándo pagar.',
    'Pagas con el método elegido y compartes el comprobante en el chat. La confirmación del pago es manual.',
  ].filter(Boolean);
  notice.querySelector('[data-steps]').innerHTML = steps.map((t) => `<li>${esc(t)}</li>`).join('');

  notice.querySelector('[data-warning]').textContent = files.length
    ? 'Tu pedido no está confirmado ni recibido hasta que Kova verifique tu mensaje y tus diseños por WhatsApp.'
    : 'Tu pedido no está enviado ni confirmado hasta que Kova lo verifique por WhatsApp.';
  notice.querySelector('[data-open]').href = whatsappUrl(message);
  notice.querySelector('.modal__cta').firstChild.textContent = 'Enviar pedido por WhatsApp ';
  notice.querySelector('[data-after]').hidden = true;
  notice.querySelector('[data-clear]').hidden = true;
  notice.querySelector('[data-notice-pay]').innerHTML = payment
    ? `<p class="modal__label">Cómo pagar: ${esc(payment.label)} · ${esc(payment.detail)}</p>${paymentDetailHtml(payment)}`
    : '';
  notice.querySelector('textarea').value = message;
  notice.querySelector('[data-copy]').textContent = 'Copiar mensaje';
  if (!notice.open) notice.showModal();
  document.body.classList.add('no-scroll');
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
