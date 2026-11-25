/**
 * Checkout (checkout.html): datos mínimos del comprador, entrega, modalidad de pago y resumen.
 *
 * El resumen lo calcula SIEMPRE el servidor (quote_cart) con los precios del catálogo, el código
 * promocional y el anticipo de la campaña. Al registrar, create_order vuelve a calcularlo todo,
 * reserva los cupos y el uso del código, y devuelve el número de pedido y el enlace privado.
 * Un doble clic o un reintento usan la misma clave, así que nunca se crean pedidos duplicados.
 */
import { CONFIG } from '../config.js';
import { mountLayout } from '../components/layout.js';
import { chapter } from '../components/chapter.js';
import { getCart, subscribe, serverItems, cartSignature, getBuyer, setBuyer, validateBuyer, clearCart, clearBuyer } from '../services/cart.js';
import { getPayments } from '../services/settings.js';
import { getShippingOptions } from '../services/storefront.js';
import { rpc, errorText, randomKey } from '../services/api.js';
import { getPromo, onPromo, removePromo } from '../services/promo.js';
import { promoFieldHtml, bindPromo } from '../components/promoField.js';
import { paymentDetailHtml, dateText } from '../components/cartView.js';
import { attachmentsFor } from '../services/contact.js';
import { formatPrice } from '../utils/format.js';
import { esc, toast } from '../utils/dom.js';
import { rememberOrder } from '../services/orders.js';

const main = document.querySelector('main');
const KEY_STORE = `${CONFIG.cart.storageKey}.checkoutKey`;
const FILES_STORE = 'kova.orderFiles';

const field = (name, label, { type = 'text', auto = '', mode = '', max = 80, ph = '', hint = '', req = true } = {}) => `
  <div class="field" data-field="${name}">
    <label class="field__label" for="co-${name}">${esc(label)}${req ? ' <span aria-hidden="true">*</span>' : ''}</label>
    <input class="field__input" id="co-${name}" name="${name}" type="${type}"${auto ? ` autocomplete="${auto}"` : ''}${mode ? ` inputmode="${mode}"` : ''}
      maxlength="${max}" placeholder="${esc(ph)}"${req ? ' required' : ''} aria-describedby="co-${name}-error${hint ? ` co-${name}-hint` : ''}">
    ${hint ? `<p class="field__hint" id="co-${name}-hint">${esc(hint)}</p>` : ''}
    <p class="field__error" id="co-${name}-error"></p>
  </div>`;

function render() {
  const cart = getCart();
  if (!cart.lines.length) {
    main.innerHTML = `
      <section class="section s-arena checkout">
        <div class="container">
          <div class="cartpage__empty grid-lines">
            <div class="cart-empty">
              <i class="ico ico--orbita cart-empty__ico" aria-hidden="true"></i>
              <p class="cart-empty__title">Tu carrito está vacío<span class="dot">.</span></p>
              <p class="cart-empty__text">Agrega una camiseta para finalizar una compra.</p>
              <a class="btn btn--primary btn--block" href="index.html#catalogo">Ver catálogo <span class="btn__arrow" aria-hidden="true">→</span></a>
            </div>
          </div>
        </div>
      </section>`;
    return;
  }
  const ships = getShippingOptions();
  const pays = getPayments();
  main.innerHTML = `
    <section class="section s-arena checkout">
      <div class="container">
        <nav class="crumbs" aria-label="Ruta">
          <a href="index.html">Inicio</a><i class="ico ico--destellos" aria-hidden="true"></i>
          <a href="carrito.html">Carrito</a><i class="ico ico--destellos" aria-hidden="true"></i>
          <span aria-current="page">Finalizar compra</span>
        </nav>
        ${chapter({ num: 'KV', title: 'Finalizar compra', note: 'Tres pasos y tu pedido queda registrado', folio: 'Checkout' })}

        <form class="checkout__grid" id="checkout-form" novalidate>
          <div class="checkout__steps">
            <fieldset class="co-step">
              <legend class="co-step__title"><span class="co-step__num">01</span> Tus datos</legend>
              ${field('name', 'Nombre completo', { auto: 'name', ph: 'Nombre y apellido' })}
              <div class="co-two">
                ${field('phone', 'WhatsApp', { type: 'tel', auto: 'tel', mode: 'tel', max: 20, ph: '300 123 4567', hint: 'Te escribimos aquí sobre tu pedido.' })}
                ${field('email', 'Correo electrónico', { type: 'email', auto: 'email', mode: 'email', max: 160, ph: 'tu@correo.com' })}
              </div>
            </fieldset>

            <fieldset class="co-step">
              <legend class="co-step__title"><span class="co-step__num">02</span> Entrega</legend>
              <div class="field" data-field="shipping">
                <span class="field__label">Método de entrega <span aria-hidden="true">*</span></span>
                <div class="co-options" role="radiogroup" aria-describedby="co-shipping-error">
                  ${ships.map((o) => `
                    <label class="co-option">
                      <input type="radio" name="shipping" value="${esc(o.id)}" data-needs-address="${o.requires_address !== false}">
                      <span><strong>${esc(o.label)}</strong><small>${o.cost == null ? 'Costo por confirmar' : o.cost === 0 ? 'Sin costo' : formatPrice(o.cost)}${o.description ? ` · ${esc(o.description)}` : ''}</small></span>
                    </label>`).join('')}
                </div>
                <p class="field__error" id="co-shipping-error"></p>
              </div>
              <div class="co-two">
                ${field('department', 'Departamento', { auto: 'address-level1', max: 60, ph: 'Valle del Cauca' })}
                ${field('city', 'Ciudad', { auto: 'address-level2', ph: 'Cali' })}
              </div>
              <div data-address-wrap>${field('address', 'Dirección de entrega', { auto: 'street-address', max: 200, ph: 'Calle, número, barrio, apto' })}</div>
              <div class="field" data-field="notes">
                <label class="field__label" for="co-notes">Indicaciones adicionales</label>
                <textarea class="field__input" id="co-notes" name="notes" maxlength="500" rows="3" placeholder="Opcional: horario, referencias, envío por separado…"></textarea>
              </div>
              <div data-mixed></div>
            </fieldset>

            <fieldset class="co-step">
              <legend class="co-step__title"><span class="co-step__num">03</span> Pago</legend>
              <div data-plan></div>
              <div class="field" data-field="payment">
                <span class="field__label">Método de pago <span aria-hidden="true">*</span></span>
                <div class="co-options" role="radiogroup" aria-describedby="co-payment-error">
                  ${pays.map((p) => `
                    <label class="co-option">
                      <input type="radio" name="payment" value="${esc(p.id)}">
                      <span><strong>${esc(p.label)}</strong><small>${esc(p.detail)}</small></span>
                    </label>`).join('')}
                </div>
                <p class="field__error" id="co-payment-error"></p>
                <div data-payment-detail></div>
              </div>
              <p class="co-paynote"><i class="ico ico--orbita" aria-hidden="true"></i> Paga después de registrar el pedido y sube el comprobante desde tu enlace de seguimiento. KOVA verifica cada pago manualmente: subir el comprobante no confirma la reserva por sí solo.</p>
            </fieldset>
          </div>

          <aside class="checkout__summary s-navy grid-lines" aria-labelledby="co-sum-title">
            <p class="eyebrow">Tu pedido</p>
            <h2 class="cartpage__sumTitle" id="co-sum-title">Resumen<span class="dot">.</span></h2>
            <ul class="co-lines">${cart.lines.map((l) => `
              <li><span class="co-lines__name">${esc(l.name)}${l.kind === 'preorder' ? ' <span class="tag tag--pre">Preventa</span>' : ''}
                <small>${[l.color, l.size && `Talla ${l.size}`, l.custom && l.mode.label, `× ${l.qty}`].filter(Boolean).map(esc).join(' · ')}</small></span>
                <span>${formatPrice(l.subtotal)}</span></li>`).join('')}</ul>
            ${promoFieldHtml('checkout')}
            <div data-quote aria-live="polite"><div class="skel skel--sum" aria-hidden="true"></div></div>
            <div class="co-legal">
              <label class="co-check"><input type="checkbox" name="accept_terms" required>
                <span>Acepto las <a href="condiciones.html" target="_blank" rel="noopener">condiciones de compra, preventa, envío, garantía y retracto</a>.</span></label>
              <label class="co-check"><input type="checkbox" name="accept_data" required>
                <span>Autorizo el <a href="condiciones.html#datos" target="_blank" rel="noopener">tratamiento de mis datos personales</a> para gestionar este pedido.</span></label>
              <p class="field__error" data-legal-error></p>
            </div>
            <button class="btn btn--primary btn--xl btn--block co-submit" type="submit" data-submit>
              <span data-submit-label>Registrar pedido</span> <i class="ico ico--destellos" aria-hidden="true"></i>
            </button>
            <p class="co-state" data-state role="status"></p>
            <a class="btn btn--line btn--block cartpage__continue" href="carrito.html">Volver al carrito</a>
          </aside>
        </form>
      </div>
    </section>`;
  bind();
}

let quote = null;
let quoting = 0;
let quoteTimer;

function planHtml(q) {
  const c = q?.campaign;
  if (!c) return '';
  const plan = getBuyer().plan || 'deposit';
  return `
    <div class="field" data-field="plan">
      <span class="field__label">Modalidad de pago de la preventa <span aria-hidden="true">*</span></span>
      <div class="co-options co-options--plan" role="radiogroup">
        <label class="co-option">
          <input type="radio" name="plan" value="deposit"${plan !== 'full' ? ' checked' : ''}>
          <span><strong>Anticipo del ${c.deposit_pct}%</strong><small>Pagas una parte ahora y el saldo antes del despacho.</small></span>
        </label>
        ${c.allow_full_payment ? `
        <label class="co-option">
          <input type="radio" name="plan" value="full"${plan === 'full' ? ' checked' : ''}>
          <span><strong>Pago completo</strong><small>Pagas el 100% ahora y no quedan saldos.</small></span>
        </label>` : ''}
      </div>
    </div>`;
}

function quoteHtml(q) {
  const t = q.quote;
  const p = q.promo ?? {};
  const shipText = t.shipping_amount == null ? 'Por confirmar' : t.shipping_amount === 0 ? 'Sin costo' : formatPrice(t.shipping_amount);
  const shipWhen = t.shipping_charge_at === 'balance' ? 'se paga con el saldo' : 'se paga con la reserva';
  const hasBalance = t.balance_after_now > 0;
  return `
    <dl class="cart-sum co-sum">
      <div><dt>Subtotal</dt><dd>${formatPrice(t.subtotal_original)}</dd></div>
      ${p.ok ? `<div class="cart-sum__promo"><dt>Código ${esc(p.code)} (${p.discount_type === 'percent' ? `${p.percent}%` : formatPrice(p.fixed_amount)})</dt><dd>−${formatPrice(t.discount_total)}</dd></div>
      <div><dt>Subtotal con descuento</dt><dd>${formatPrice(t.subtotal_after)}</dd></div>` : ''}
      <div><dt>Envío${t.shipping_amount != null && q.campaign ? ` <small>(${shipWhen})</small>` : ''}</dt><dd>${shipText}</dd></div>
      <div class="cart-sum__total"><dt>Total del pedido</dt><dd>${formatPrice(t.total)}${t.shipping_amount == null ? '<small> + envío</small>' : ''}</dd></div>
      ${q.campaign && getBuyer().plan !== 'full' && hasBalance ? `<div><dt>Anticipo de la preventa (${q.campaign.deposit_pct}%)</dt><dd>${formatPrice(t.lines.filter((l) => l.kind === 'preorder').reduce((n, l) => n + l.due_now, 0))}</dd></div>` : ''}
      <div class="cart-sum__now"><dt>Valor a pagar ahora</dt><dd>${formatPrice(t.amount_due_now)}</dd></div>
      ${hasBalance ? `<div><dt>Saldo pendiente</dt><dd>${formatPrice(t.balance_after_now)}${t.shipping_amount == null ? '<small> + envío</small>' : ''}</dd></div>` : ''}
    </dl>
    ${q.campaign?.est_dispatch_date ? `<p class="cart-sum__note">Despacho estimado de la preventa: <b>${esc(dateText(q.campaign.est_dispatch_date))}</b>.</p>` : ''}
    ${p.ok === false && getPromo().code ? `<p class="cart-sum__note is-error">${esc(p.message)}</p>` : ''}`;
}

async function refreshQuote() {
  const box = main.querySelector('[data-quote]');
  if (!box) return;
  const b = getBuyer();
  const my = ++quoting;
  box.classList.add('is-loading');
  try {
    const promo = getPromo();
    const q = await rpc('quote_cart', {
      p_items: serverItems(), p_code: promo.status === 'ok' || promo.status === 'pending' ? promo.code : '',
      p_email: b.email || '', p_phone: b.phone || '', p_plan: b.plan || 'deposit', p_shipping: b.shipping || '',
    });
    if (my !== quoting) return;
    quote = q;
    box.innerHTML = quoteHtml(q);
    const planBox = main.querySelector('[data-plan]');
    if (Boolean(q.campaign) !== Boolean(planBox.querySelector('[name="plan"]'))) planBox.innerHTML = planHtml(q);
    setState('');
    main.querySelector('[data-submit]').disabled = false;
    main.querySelector('[data-submit-label]').textContent = q.campaign ? 'Reservar ahora' : 'Registrar pedido';
  } catch (err) {
    if (my !== quoting) return;
    quote = null;
    box.innerHTML = `<p class="co-error"><b>No pudimos calcular tu pedido.</b> ${esc(errorText(err))}</p>`;
    main.querySelector('[data-submit]').disabled = Boolean(err?.friendly);
  } finally {
    if (my === quoting) box.classList.remove('is-loading');
  }
}
const queueQuote = (ms = 300) => { clearTimeout(quoteTimer); quoteTimer = setTimeout(refreshQuote, ms); };

function setState(text, tone = '') {
  const el = main.querySelector('[data-state]');
  if (!el) return;
  el.textContent = text;
  el.className = `co-state${tone ? ` is-${tone}` : ''}`;
}

const needsAddress = () => main.querySelector('[name="shipping"]:checked')?.dataset.needsAddress !== 'false';

function showErrors(errors, only = null) {
  ['name', 'phone', 'email', 'department', 'city', 'address', 'shipping', 'payment'].forEach((f) => {
    if (only && !only.has(f)) return;
    const wrap = main.querySelector(`[data-field="${f}"]`);
    if (!wrap) return;
    const msg = errors[f] ?? '';
    wrap.classList.toggle('is-error', Boolean(msg));
    wrap.querySelector('.field__input')?.setAttribute('aria-invalid', String(Boolean(msg)));
    wrap.querySelector('.field__error').textContent = msg;
  });
}

function mixedNotice() {
  const cart = getCart();
  const pre = cart.lines.filter((l) => l.kind === 'preorder');
  const now = cart.lines.filter((l) => l.kind !== 'preorder');
  const box = main.querySelector('[data-mixed]');
  if (!pre.length || !now.length) { box.innerHTML = ''; return; }
  const d = pre[0].campaign?.dispatch;
  box.innerHTML = `<div class="co-mixed" role="note"><i class="ico ico--destellos" aria-hidden="true"></i>
    <p><b>Tu pedido tiene productos con fechas de despacho distintas.</b> ${now.length === 1 ? 'El producto disponible' : 'Los productos disponibles'} se pueden enviar ya y la preventa${d ? ` hacia el ${esc(dateText(d))}` : ' cuando esté lista'}.
    Por defecto enviamos todo junto con la preventa. Si prefieres dos envíos, escríbelo en las indicaciones: el costo del envío adicional se confirma por WhatsApp.</p></div>`;
}

function bind() {
  const form = main.querySelector('#checkout-form');
  const b = getBuyer();
  ['name', 'phone', 'email', 'department', 'city', 'address', 'notes'].forEach((f) => { if (form.elements[f]) form.elements[f].value = b[f] ?? ''; });
  const ships = getShippingOptions();
  const shipId = b.shipping && ships.some((o) => o.id === b.shipping) ? b.shipping : ships.length === 1 ? ships[0].id : '';
  if (shipId) { form.querySelector(`[name="shipping"][value="${CSS.escape(shipId)}"]`).checked = true; setBuyer({ shipping: shipId }); }
  if (b.payment) { const r = form.querySelector(`[name="payment"][value="${CSS.escape(b.payment)}"]`); if (r) r.checked = true; }
  const showPay = () => { form.querySelector('[data-payment-detail]').innerHTML = paymentDetailHtml(getPayments().find((p) => p.id === getBuyer().payment)); };
  const toggleAddress = () => { form.querySelector('[data-address-wrap]').hidden = !needsAddress(); };
  showPay(); toggleAddress(); mixedNotice();
  bindPromo(form);

  const touched = new Set();
  form.addEventListener('input', (e) => {
    const { name, value, type } = e.target;
    if (!name || type === 'checkbox') return;
    setBuyer({ [name]: value });
    if (name === 'payment') showPay();
    if (name === 'shipping') { toggleAddress(); queueQuote(0); }
    if (name === 'plan') queueQuote(0);
    if (name === 'email' || name === 'phone') queueQuote(700);
    if (touched.has(name)) showErrors(validateBuyer(getBuyer(), { needsAddress: needsAddress() }).errors, new Set([name]));
  });
  form.addEventListener('focusout', (e) => {
    if (!e.target.name || !e.target.value?.trim?.()) return;
    touched.add(e.target.name);
    showErrors(validateBuyer(getBuyer(), { needsAddress: needsAddress() }).errors, new Set([e.target.name]));
  });
  form.addEventListener('submit', (e) => { e.preventDefault(); submit(form); });
  onPromo((s) => { if (s.status !== 'loading') queueQuote(0); });
  queueQuote(0);
}

/** Clave de idempotencia: la misma mientras no cambien el carrito ni las condiciones elegidas. */
function checkoutKey() {
  const b = getBuyer();
  const sig = [cartSignature(), b.plan, b.shipping, getPromo().code, b.email].join('#');
  try {
    const saved = JSON.parse(sessionStorage.getItem(KEY_STORE) || 'null');
    if (saved?.sig === sig) return saved.key;
  } catch { /* sin almacenamiento */ }
  const key = randomKey();
  try { sessionStorage.setItem(KEY_STORE, JSON.stringify({ sig, key })); } catch { /* sin almacenamiento */ }
  return key;
}

let sending = false;
async function submit(form) {
  if (sending) return;
  const v = validateBuyer(getBuyer(), { needsAddress: needsAddress() });
  showErrors(v.errors);
  const terms = form.elements.accept_terms.checked;
  const data = form.elements.accept_data.checked;
  form.querySelector('[data-legal-error]').textContent = terms && data ? '' : 'Para continuar acepta las condiciones y autoriza el tratamiento de tus datos.';
  if (!v.ok) {
    const first = Object.keys(v.errors)[0];
    (form.querySelector(`[data-field="${first}"] input`) ?? form).focus();
    setState('Revisa los campos marcados.', 'error');
    return;
  }
  if (!terms || !data) { form.elements[terms ? 'accept_data' : 'accept_terms'].focus(); return; }
  const promo = getPromo();
  if (promo.status === 'error' && promo.code) { setState('Quita o corrige el código promocional antes de continuar.', 'error'); return; }

  sending = true;
  const btn = form.querySelector('[data-submit]');
  btn.disabled = true;
  btn.classList.add('is-loading');
  const label = form.querySelector('[data-submit-label]');
  const prev = label.textContent;
  label.textContent = 'Registrando…';
  setState('Registrando tu pedido de forma segura…');
  const b = getBuyer();
  const cart = getCart();
  const payload = {
    idempotency_key: checkoutKey(),
    items: serverItems(),
    promo_code: promo.code || '',
    payment_plan: b.plan || 'deposit',
    payment_method: b.payment,
    shipping_method: b.shipping,
    accept_terms: true,
    accept_data: true,
    buyer: { full_name: v.buyer.name, email: v.buyer.email, whatsapp: b.phone, department: b.department, city: b.city, address: needsAddress() ? b.address : '', notes: b.notes },
  };
  // Hasta 2 reintentos automáticos si se cae la conexión (misma clave: no se duplica).
  let res; let lastErr;
  for (let i = 0; i < 3 && !res; i++) {
    try { res = await rpc('create_order', { p: payload }, { timeoutMs: 20000 }); } catch (err) {
      lastErr = err;
      if (err.friendly) break;
      await new Promise((r) => setTimeout(r, 800 * (i + 1)));
    }
  }
  if (!res) {
    sending = false;
    btn.disabled = false;
    btn.classList.remove('is-loading');
    label.textContent = prev;
    setState(errorText(lastErr), 'error');
    toast(errorText(lastErr));
    if (lastErr?.friendly) queueQuote(0);
    return;
  }
  // Archivos de KOVA CUSTOM por adjuntar en WhatsApp (solo nombres; los diseños nunca se suben).
  try { sessionStorage.setItem(FILES_STORE, JSON.stringify({ number: res.number, files: attachmentsFor(cart) })); } catch { /* sin almacenamiento */ }
  rememberOrder({ number: res.number, token: res.token });
  clearCart();
  removePromo();
  const keep = getBuyer();
  clearBuyer();
  setBuyer({ name: keep.name, phone: keep.phone, email: keep.email, department: keep.department, city: keep.city, address: keep.address });
  try { sessionStorage.removeItem(KEY_STORE); } catch { /* sin almacenamiento */ }
  location.href = `pedido.html?nuevo=1#${res.token}`;
}

mountLayout();
render();
let lastSig = cartSignature();
subscribe(() => {
  if (sending || cartSignature() === lastSig) return;
  lastSig = cartSignature();
  render();
});
