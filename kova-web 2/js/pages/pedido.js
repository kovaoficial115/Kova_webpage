/**
 * Seguimiento privado del pedido (pedido.html#<token>).
 * El token de 64 caracteres es la única llave: el número de pedido solo no da acceso a nada.
 * El enlace va después de # para que nunca viaje al servidor web ni quede en registros de visitas.
 */
import { CONFIG } from '../config.js';
import { mountLayout } from '../components/layout.js';
import { chapter } from '../components/chapter.js';
import { rpc, errorText, uploadToReservedPath, sha256Hex } from '../services/api.js';
import { getPayments } from '../services/settings.js';
import { paymentDetailHtml, dateText } from '../components/cartView.js';
import { buildRegisteredOrderMessage, whatsappUrl, copyText } from '../services/contact.js';
import { myOrders, trackingUrl, rememberOrder } from '../services/orders.js';
import { getDesigns, removeDesign } from '../services/designStore.js';
import { FINANCIAL, FULFILLMENT, FULFILLMENT_STEPS, PAYMENT_KIND, PAYMENT_STATUS, tone } from '../data/orderStatus.js';
import { formatPrice } from '../utils/format.js';
import { esc, toast } from '../utils/dom.js';

const main = document.querySelector('main');
const token = decodeURIComponent(location.hash.slice(1)).trim().toLowerCase();
const isNew = new URLSearchParams(location.search).has('nuevo');
const pill = (s, map) => `<span class="o-pill o-pill--${tone(s)}">${esc(map[s] ?? s)}</span>`;
const dt = (iso) => new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });

function frame(inner) {
  main.innerHTML = `
    <section class="section s-arena orderpage">
      <div class="container">
        <nav class="crumbs" aria-label="Ruta"><a href="index.html">Inicio</a><i class="ico ico--destellos" aria-hidden="true"></i><span aria-current="page">Mi pedido</span></nav>
        ${inner}
      </div>
    </section>`;
}

function renderList() {
  const list = myOrders();
  frame(`
    ${chapter({ num: 'KV', title: 'Mis pedidos', note: 'Pedidos registrados desde este dispositivo', folio: `${String(list.length).padStart(2, '0')} pedidos` })}
    ${list.length ? `<ul class="o-mine">${list.map((o) => `
      <li><a href="pedido.html#${o.token}"><b>${esc(o.number)}</b><span>${esc(dateText(o.at))}</span><span class="btn__arrow" aria-hidden="true">→</span></a></li>`).join('')}</ul>`
    : `<div class="cart-empty"><p class="cart-empty__title">No hay pedidos en este dispositivo<span class="dot">.</span></p>
       <p class="cart-empty__text">Abre el enlace privado que recibiste al registrar tu pedido. Si lo perdiste, escríbenos por WhatsApp con tu número de pedido y tu correo.</p>
       <a class="btn btn--primary" href="${whatsappUrl('Hola, KOVA. Perdí el enlace de seguimiento de mi pedido.')}" target="_blank" rel="noopener">Escribir por WhatsApp <span class="btn__arrow" aria-hidden="true">↗</span></a></div>`}`);
}

function skeleton() {
  frame(`<div class="o-skel" aria-busy="true" aria-label="Cargando pedido"><div class="skel skel--title"></div><div class="skel skel--block"></div><div class="skel skel--block"></div></div>`);
}

function timeline(o) {
  if (['cancelled', 'expired'].includes(o.fulfillment_status)) {
    return `<div class="o-ended">${pill(o.fulfillment_status, FULFILLMENT)}<p>${o.fulfillment_status === 'expired' ? 'El plazo para pagar se venció y las unidades se liberaron. Si ya pagaste, escríbenos de inmediato.' : 'Este pedido fue cancelado.'}</p></div>`;
  }
  const idx = FULFILLMENT_STEPS.indexOf(o.fulfillment_status === 'ready' ? 'packed' : o.fulfillment_status);
  return `<ol class="o-steps">${FULFILLMENT_STEPS.map((s, i) => `
    <li class="${i < idx ? 'is-done' : i === idx ? 'is-current' : ''}"><span class="o-steps__dot" aria-hidden="true"></span>
      <span class="o-steps__label">${esc(FULFILLMENT[s])}</span>${i === idx ? '<span class="sr-only"> (estado actual)</span>' : ''}</li>`).join('')}</ol>`;
}

function render(o) {
  document.title = `Pedido ${o.number} — ${CONFIG.brand.name}`;
  const balance = o.balance;
  const confirmed = !['pending_confirmation', 'cancelled', 'expired'].includes(o.fulfillment_status);
  const pending = o.payments.filter((p) => ['submitted', 'verifying'].includes(p.status));
  const isPre = o.kind === 'preorder' || o.kind === 'mixed';
  const pendingSum = o.payments.filter((p) => ['submitted', 'verifying'].includes(p.status)).reduce((n, p) => n + p.amount, 0);
  const payNow = Math.max((o.paid_total === 0 ? o.amount_due_now : balance) - pendingSum, 0) || Math.max(balance - pendingSum, 0) || balance;
  const waMsg = buildRegisteredOrderMessage(o);
  const method = getPayments().find((p) => p.id === o.payment_method) ?? getPayments()[0];
  const payForm = () => `
          <p class="o-pay__amount"><span>Valor a transferir</span><b>${formatPrice(payNow)}</b></p>
          ${method ? paymentDetailHtml(method) : ''}
          <form class="o-upload" data-upload novalidate>
            <div class="field"><label class="field__label" for="up-file">Comprobante (imagen o PDF, máx. 8 MB) <span aria-hidden="true">*</span></label>
              <input class="field__input o-upload__file" id="up-file" name="file" type="file" accept="image/*,application/pdf" required></div>
            <div class="co-two">
              <div class="field"><label class="field__label" for="up-amount">Valor transferido <span aria-hidden="true">*</span></label>
                <input class="field__input" id="up-amount" name="amount" inputmode="numeric" value="${payNow}" required></div>
              <div class="field"><label class="field__label" for="up-date">Fecha de la transferencia <span aria-hidden="true">*</span></label>
                <input class="field__input" id="up-date" name="date" type="date" required value="${new Date().toLocaleDateString('en-CA', { timeZone: 'America/Bogota' })}"></div>
            </div>
            <div class="field"><label class="field__label" for="up-ref">Referencia o número de aprobación</label>
              <input class="field__input" id="up-ref" name="reference" maxlength="80" placeholder="Opcional, ayuda a verificar más rápido"></div>
            <p class="field__error" data-up-error></p>
            <button class="btn btn--primary btn--block" type="submit" data-up-btn>Enviar comprobante <i class="ico ico--destellos" aria-hidden="true"></i></button>
            <p class="o-upload__hint">El comprobante se guarda de forma privada: solo lo ve el equipo de KOVA.</p>
          </form>
`;

  frame(`
    ${isNew ? `<div class="o-banner s-navy grid-lines" role="status">
      <i class="ico ico--destellos o-banner__ico" aria-hidden="true"></i>
      <div><p class="eyebrow">Solicitud registrada</p>
      <h1 class="o-banner__title">Tu ${isPre ? 'reserva' : 'pedido'} quedó registrado<span class="dot">.</span></h1>
      <p>Número <b>${esc(o.number)}</b>. ${isPre ? 'La reserva se confirma cuando KOVA verifique tu pago' : 'El pedido se confirma cuando KOVA verifique tu pago'}: transfiere ${formatPrice(o.amount_due_now)} y sube el comprobante aquí abajo.</p>
      <p class="o-banner__save"><b>Guarda este enlace:</b> es privado y es la única forma de ver tu pedido. <button class="adm-link o-copy" type="button" data-copy-link>Copiar enlace</button></p></div>
    </div>` : ''}
    ${chapter({ num: 'KV', title: `Pedido ${o.number}`, note: `Registrado el ${dt(o.created_at)}`, folio: isPre ? 'Preventa' : 'Pedido' })}

    <div class="o-grid">
      <div class="o-main">
        <section class="o-card" aria-labelledby="o-st">
          <h2 class="o-card__title" id="o-st">Estado</h2>
          <div class="o-status">
            <div><span class="o-status__k">Pago</span>${pill(o.financial_status, FINANCIAL)}</div>
            <div><span class="o-status__k">Pedido</span>${pill(o.fulfillment_status, FULFILLMENT)}</div>
          </div>
          ${timeline(o)}
          ${!confirmed && !['cancelled', 'expired'].includes(o.fulfillment_status) ? `<p class="o-note">${pending.length ? 'Recibimos tu comprobante. KOVA lo está revisando: te avisaremos por WhatsApp.' : `Pendiente de pago${o.hold_expires_at ? `. Tu reserva se mantiene hasta el <b>${esc(dt(o.hold_expires_at))}</b>` : ''}.`}</p>` : ''}
          ${o.est_dispatch_date ? `<p class="o-note">Despacho estimado: <b>${esc(dateText(o.est_dispatch_date))}</b>${o.campaign?.est_delivery_date ? ` · Entrega estimada: <b>${esc(dateText(o.campaign.est_delivery_date))}</b>` : ''}</p>` : ''}
          ${o.tracking_number ? `<p class="o-note">Guía de envío: <b>${esc(o.tracking_number)}</b>${o.carrier ? ` (${esc(o.carrier)})` : ''}</p>` : ''}
        </section>

        ${designsCard()}

        ${o.can_upload && balance > 0 && pending.length ? `
        <section class="o-card o-pay" id="pagar"><details class="o-more"><summary>¿Necesitas enviar otro comprobante?</summary>${payForm()}</details></section>`
        : o.can_upload && balance > 0 ? `
        <section class="o-card o-pay" aria-labelledby="o-pay" id="pagar">
          <h2 class="o-card__title" id="o-pay">${o.paid_total === 0 ? 'Pagar y subir comprobante' : 'Pagar el saldo'}</h2>${payForm()}</section>` : ''}


        <section class="o-card" aria-labelledby="o-hist">
          <h2 class="o-card__title" id="o-hist">Historial</h2>
          <ol class="o-history">${o.history.slice().reverse().map((h) => `
            <li><time>${esc(dt(h.at))}</time><b>${esc(h.event)}</b>${h.note ? `<span>${esc(h.note)}</span>` : ''}</li>`).join('')}</ol>
        </section>
      </div>

      <aside class="o-side s-navy grid-lines">
        <p class="eyebrow">Resumen</p>
        <ul class="co-lines">${o.items.map((i) => `
          <li><span class="co-lines__name">${esc(i.name)}${i.kind === 'preorder' ? ' <span class="tag tag--pre">Preventa</span>' : ''}
            <small>${[i.custom?.mode_label, i.color, i.size && `Talla ${i.size}`, `× ${i.qty}`].filter(Boolean).map(esc).join(' · ')}</small></span>
            <span>${formatPrice(i.line_final)}${i.discount ? `<s>${formatPrice(i.line_original)}</s>` : ''}</span></li>`).join('')}</ul>
        <dl class="cart-sum">
          <div><dt>Subtotal</dt><dd>${formatPrice(o.subtotal_original)}</dd></div>
          ${o.promo_code ? `<div class="cart-sum__promo"><dt>Código ${esc(o.promo_code)}</dt><dd>−${formatPrice(o.discount_total)}</dd></div>` : ''}
          <div><dt>Envío</dt><dd>${o.shipping_amount == null ? 'Por confirmar' : formatPrice(o.shipping_amount)}</dd></div>
          <div class="cart-sum__total"><dt>Total</dt><dd>${formatPrice(o.total)}</dd></div>
          ${o.amount_due_now < o.total ? `<div><dt>${o.deposit_pct ? `Anticipo (${o.deposit_pct}%)` : 'A pagar para reservar'}</dt><dd>${formatPrice(o.amount_due_now)}</dd></div>` : ''}
          <div><dt>Pagado y verificado</dt><dd>${formatPrice(o.paid_total - o.refunded_total)}</dd></div>
          ${pending.length ? `<div><dt>Por verificar</dt><dd>${formatPrice(pending.reduce((n, p) => n + p.amount, 0))}</dd></div>` : ''}
          <div class="cart-sum__now"><dt>Saldo pendiente</dt><dd>${formatPrice(balance)}</dd></div>
        </dl>
        ${o.payments.length ? `<p class="modal__label">Pagos</p><ul class="o-pays">${o.payments.map((p) => `
          <li><span>${esc(PAYMENT_KIND[p.kind] ?? p.kind)} · ${formatPrice(p.amount)}</span>${pill(p.status, PAYMENT_STATUS)}${p.reject_reason ? `<small>${esc(p.reject_reason)}</small>` : ''}</li>`).join('')}</ul>` : ''}
        <a class="btn btn--primary btn--block" href="${whatsappUrl(waMsg)}" target="_blank" rel="noopener" data-wa>Escribir a KOVA por WhatsApp <span class="btn__arrow" aria-hidden="true">↗</span></a>
        ${balance > 0 && o.can_upload ? '<a class="btn btn--line btn--block" href="#pagar">Pagar / subir comprobante</a>' : ''}
        ${missingDesigns() ? '<a class="btn btn--line btn--block" href="#disenos">Subir mis diseños</a>' : ''}
        <p class="o-legal"><a href="condiciones.html" target="_blank" rel="noopener">Condiciones de compra, garantía y retracto</a></p>
      </aside>
    </div>`);

  main.querySelector('[data-copy-link]')?.addEventListener('click', async () => {
    toast((await copyText(trackingUrl(token))) ? 'Enlace copiado. Guárdalo en un lugar seguro.' : 'No se pudo copiar: copia la dirección de esta página.');
  });
  main.querySelector('[data-wa]').addEventListener('click', () => copyText(waMsg));
  bindUpload(o);
  bindDesigns();
}

/* =========================================================================
 * Diseños de KOVA CUSTOM: se suben al bucket privado con el token del pedido
 * ========================================================================= */
const FACE = { front: 'Frente', back: 'Espalda' };
const DESIGN_EXT = /\.(png|jpe?g|webp|pdf)$/i;
const DESIGN_MIME = ['image/png', 'image/jpeg', 'image/webp', 'application/pdf'];
let designs = null;                 // respuesta de get_order_designs (null si el pedido no tiene KOVA CUSTOM)
const progress = new Map();         // "línea:cara" → { pct } o { error }
const fmtBytes = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round((b || 0) / 1024))} KB`);
const maxMb = () => Math.round((designs?.max_bytes ?? 26214400) / 1024 / 1024);

function missingDesigns() {
  if (!designs?.can_upload) return 0;
  return designs.lines.reduce((n, l) => n + l.faces.filter((f) => !l.designs.some((d) => d.face === f)).length, 0);
}

function designRow(l, face) {
  const key = `${l.line_no}:${face}`;
  const d = l.designs.find((x) => x.face === face);
  const p = progress.get(key);
  const pick = (text, cls = 'btn btn--line btn--sm') => `<label class="${cls} o-dpick">${text}
    <input type="file" accept="${DESIGN_MIME.join(',')},.png,.jpg,.jpeg,.webp,.pdf" data-dfile="${key}" class="sr-only"></label>`;
  let body;
  if (p && 'pct' in p) body = `<span class="o-dstate is-busy">Subiendo… ${Math.round(p.pct * 100)} %</span><progress max="100" value="${Math.round(p.pct * 100)}"></progress>`;
  else if (d) body = `<span class="o-dstate is-ok">✓ Recibido: <b>${esc(d.file_name)}</b> <small>${esc(fmtBytes(d.size_bytes))}</small></span>${designs.can_upload ? pick('Cambiar', 'adm-link o-dpick') : ''}`;
  else if (designs.can_upload) body = `<span class="o-dstate is-off">Pendiente</span>${pick('Subir archivo')}`;
  else body = '<span class="o-dstate is-off">No recibido: escríbenos por WhatsApp</span>';
  return `<div class="o-drow" data-drow="${key}"><span class="o-drow__face">${FACE[face]}</span>${body}
    ${p?.error ? `<p class="field__error">${esc(p.error)}</p>` : ''}</div>`;
}

function designsCard() {
  if (!designs?.lines?.length) return '';
  const missing = missingDesigns();
  return `
        <section class="o-card o-designs" id="disenos" aria-labelledby="o-dis">
          <h2 class="o-card__title" id="o-dis">Tus diseños · KOVA Custom</h2>
          <p class="o-note">${designs.can_upload
            ? (missing ? `Sube el archivo original de cada estampado (PNG, JPG, WEBP o PDF · máx. ${maxMb()} MB). Sin el diseño no podemos empezar la producción.`
              : 'Recibimos todos tus diseños. Puedes cambiarlos hasta que empecemos a producir tu pedido.')
            : 'Tu pedido ya está en producción: los diseños no se pueden cambiar desde aquí.'}</p>
          ${designs.lines.map((l) => `
          <div class="o-dline">
            <p class="o-dline__name"><b>Producto ${l.line_no}</b> · ${esc(l.mode_label || l.name)}</p>
            ${l.faces.map((f) => designRow(l, f)).join('')}
          </div>`).join('')}
          <p class="o-upload__hint">Tus archivos se guardan de forma privada: solo los ve el equipo de KOVA.</p>
        </section>`;
}

function redrawRow(line, face) {
  const l = designs.lines.find((x) => x.line_no === line);
  const el = main.querySelector(`[data-drow="${line}:${face}"]`);
  if (l && el) el.outerHTML = designRow(l, face);
}

function redrawDesigns() {
  const card = main.querySelector('#disenos');
  if (card) card.outerHTML = designsCard();
}

async function refreshDesigns() {
  try { designs = await rpc('get_order_designs', { p_token: token }); } catch { /* se mantiene lo último */ }
  redrawDesigns();
}

async function uploadDesign(line, face, file) {
  const key = `${line}:${face}`;
  if (progress.get(key)?.pct !== undefined) return false;
  const fail = (msg) => { progress.set(key, { error: msg }); redrawRow(line, face); return false; };
  if (!DESIGN_EXT.test(file.name) || (file.type && !DESIGN_MIME.includes(file.type))) return fail('Formato no admitido. Sube PNG, JPG, WEBP o PDF.');
  if (file.size > (designs.max_bytes ?? 26214400)) return fail(`«${file.name}» pesa ${fmtBytes(file.size)}. El máximo es ${maxMb()} MB.`);
  if (file.size < 100) return fail(`«${file.name}» está vacío o dañado.`);
  progress.set(key, { pct: 0 }); redrawRow(line, face);
  try {
    const ext = file.name.split('.').pop().toLowerCase();
    const [slot, sha] = await Promise.all([
      rpc('request_design_upload', { p_token: token, p_line: line, p_face: face, p_ext: ext }),
      sha256Hex(file).catch(() => ''),
    ]);
    let last = 0;
    await uploadToReservedPath(slot.bucket, slot.path, file, {
      maxMb: maxMb(), kind: 'PNG, JPG, WEBP o PDF',
      onProgress: (pct) => { if (pct - last >= 0.02 || pct === 1) { last = pct; progress.set(key, { pct }); redrawRow(line, face); } },
    });
    await rpc('submit_design_file', { p_token: token, p: { path: slot.path, file_name: file.name, sha256: sha } });
    progress.delete(key);
    const l = designs.lines.find((x) => x.line_no === line);
    if (l?.ref) removeDesign(l.ref, face);
    await refreshDesigns();
    return true;
  } catch (err) { return fail(errorText(err)); }
}

function bindDesigns() {
  const card = main.querySelector('.o-grid');
  if (!card || card.dataset.dbound) return;
  card.dataset.dbound = '1';
  card.addEventListener('change', async (e) => {
    const input = e.target.closest('[data-dfile]');
    if (!input?.files?.[0]) return;
    const [line, face] = input.dataset.dfile.split(':');
    if (await uploadDesign(Number(line), face, input.files[0])) toast('Diseño recibido. ¡Gracias!');
  });
}

/** Sube solos los diseños que el cliente eligió en KOVA Custom y siguen guardados en este navegador. */
async function autoUploadDesigns() {
  if (!designs?.lines?.length) return;
  let sent = 0;
  for (const l of designs.lines) {
    if (!l.ref) continue;
    const local = await getDesigns(l.ref);
    for (const face of Object.keys(local)) {
      if (!l.faces.includes(face)) continue;
      if (l.designs.some((d) => d.face === face)) { removeDesign(l.ref, face); continue; }
      if (!designs.can_upload) continue;
      if (await uploadDesign(l.line_no, face, local[face])) sent++;
    }
  }
  if (sent) toast(sent > 1 ? 'Tus diseños llegaron a KOVA.' : 'Tu diseño llegó a KOVA.');
}

function bindUpload(o) {
  const form = main.querySelector('[data-upload]');
  if (!form) return;
  const err = form.querySelector('[data-up-error]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const file = form.elements.file.files[0];
    const amount = Number(String(form.elements.amount.value).replace(/\D/g, ''));
    err.textContent = '';
    if (!file) { err.textContent = 'Elige el archivo del comprobante.'; return; }
    if (file.size > 8 * 1024 * 1024) { err.textContent = 'El archivo pesa más de 8 MB. Toma una captura de pantalla del comprobante.'; return; }
    if (!amount) { err.textContent = 'Escribe el valor que transferiste.'; return; }
    if (!form.elements.date.value) { err.textContent = 'Escribe la fecha de la transferencia.'; return; }
    const btn = form.querySelector('[data-up-btn]');
    btn.disabled = true; btn.classList.add('is-loading');
    const prev = btn.innerHTML;
    btn.textContent = 'Subiendo comprobante…';
    try {
      const ext = (file.name.split('.').pop() || '').toLowerCase().replace('jpeg', 'jpg') || (file.type === 'application/pdf' ? 'pdf' : 'jpg');
      const [slot, sha] = await Promise.all([rpc('request_proof_upload', { p_token: token, p_ext: ext }), sha256Hex(file)]);
      await uploadToReservedPath(slot.bucket, slot.path, file);
      await rpc('submit_payment_proof', { p_token: token, p: { path: slot.path, sha256: sha, amount, reference: form.elements.reference.value, transfer_date: form.elements.date.value, method: o.payment_method } });
      toast('Comprobante enviado. KOVA lo revisará y te confirmará por WhatsApp.');
      load();
    } catch (ex) {
      err.textContent = errorText(ex);
      btn.disabled = false; btn.classList.remove('is-loading'); btn.innerHTML = prev;
    }
  });
}

async function load() {
  if (!/^[0-9a-f]{64}$/.test(token)) return renderList();
  if (!main.querySelector('.o-grid')) skeleton();
  try {
    const o = await rpc('get_order_public', { p_token: token });
    rememberOrder({ number: o.number, token });
    if (o.items.some((i) => i.custom)) designs = await rpc('get_order_designs', { p_token: token }).catch(() => designs);
    render(o);
    autoUploadDesigns();
  } catch (err) {
    frame(`<div class="o-card o-error"><h1 class="o-card__title">No pudimos abrir el pedido<span class="dot">.</span></h1><p>${esc(errorText(err))}</p>
      <button class="btn btn--primary" type="button" data-reload>Reintentar</button>
      <a class="btn btn--line" href="pedido.html">Mis pedidos</a></div>`);
  }
}

mountLayout();
window.addEventListener('hashchange', () => location.reload());
load();

// Botones "Reintentar": sin onclick en línea para que la CSP pueda bloquear scripts inline.
document.addEventListener('click', (e) => { if (e.target.closest('[data-reload]')) location.reload(); });
