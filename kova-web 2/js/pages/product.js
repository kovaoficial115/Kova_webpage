import { getProductById, getCategory, getRelated, purchaseState } from '../services/catalog.js';
import { depositOf, serverNow } from '../services/storefront.js';
import { dateText } from '../components/cartView.js';
import { productGrid, productRef } from '../components/productCard.js';
import { createContactModal } from '../components/contactModal.js';
import { chapter } from '../components/chapter.js';
import { mountLayout } from '../components/layout.js';
import { formatPrice, pad } from '../utils/format.js';
import { esc, toast } from '../utils/dom.js';
import { productAlt, imageView } from '../utils/alt.js';
import { addItem } from '../services/cart.js';
import { CONFIG } from '../config.js';

const main = document.querySelector('main');
// Acepta producto.html#id (formato actual) y producto.html?id=id (enlaces antiguos).
const productId = decodeURIComponent(location.hash.slice(1)) || new URLSearchParams(location.search).get('id');
const product = getProductById(productId);

// Al pasar de un producto a otro solo cambia el #, así que se recarga la vista.
window.addEventListener('hashchange', () => location.reload());

function renderNotFound() {
  document.title = `Producto no encontrado — ${CONFIG.brand.name}`;
  main.innerHTML = `
    <section class="notfound s-navy">
      <div class="container">
        <div class="notfound__frame grid-lines">
          <span class="notfound__pill">404 — Basic not found</span>
          <h1 class="notfound__title">Producto no encontrado<span class="dot">.</span></h1>
          <p>Puede que el enlace esté mal escrito o que el producto ya no exista.</p>
          <a class="btn btn--primary btn--xl" href="index.html#catalogo">Volver al catálogo <span class="btn__arrow" aria-hidden="true">→</span></a>
        </div>
      </div>
    </section>`;
}

function renderGallery() {
  const many = product.images.length > 1;
  const thumbs = many
    ? `<div class="gallery__thumbs">${product.images.map((src, i) => `
        <button type="button" class="gallery__thumb${i === 0 ? ' is-active' : ''}" data-index="${i}" aria-label="Ver ${esc(imageView(src) ?? `imagen ${i + 1}`)}" aria-pressed="${i === 0}">
          <img src="${src}" alt="${esc(productAlt(product, i, { short: true }))}" width="160" height="200" loading="lazy">
        </button>`).join('')}</div>`
    : '';
  return `
    <div class="gallery">
      <div class="gallery__main">
        ${product.images.map((src, i) => `
          <img class="gallery__img${i === 0 ? ' is-active' : ''}" src="${src}" alt="${esc(productAlt(product, i))}" width="800" height="1000"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>`).join('')}
        <span class="gallery__count" aria-hidden="true">${many ? `<b data-current>01</b> / ${pad(product.images.length, 2)}` : ''}</span>
      </div>
      ${thumbs}
    </div>`;
}

function renderSizes(pre) {
  if (!product.sizes?.length) return '';
  const out = pre ? [] : (product.soldOutSizes ?? []);
  return `
    <fieldset class="sizes" data-sizes>
      <legend class="sizes__legend">Talla <span class="sizes__hint" data-size-hint>Elige una talla</span></legend>
      <div class="sizes__list">
        ${product.sizes.map((s) => `
          <label class="size${out.includes(s) ? ' is-out' : ''}">
            <input type="radio" name="size" value="${esc(s)}"${out.includes(s) ? ' disabled' : ''}>
            <span>${esc(s)}</span>
          </label>`).join('')}
      </div>
    </fieldset>`;
}

// Solo se muestra si el producto define colores en products.js (hoy ninguno los tiene).
function renderColors() {
  if (!product.colors?.length) return '';
  return `
    <fieldset class="sizes colors" data-colors>
      <legend class="sizes__legend">Color <span class="sizes__hint" data-color-hint>Elige un color</span></legend>
      <div class="sizes__list">
        ${product.colors.map((c) => `
          <label class="size color" title="${esc(c.name)}">
            <input type="radio" name="color" value="${esc(c.name)}">
            <span style="--swatch:${esc(c.hex ?? 'transparent')}"><span class="color__name">${esc(c.name)}</span></span>
          </label>`).join('')}
      </div>
    </fieldset>`;
}

function renderQty() {
  return `
    <div class="pdp__qty" data-qty-group>
      <span class="sizes__legend">Cantidad</span>
      <div class="qty" role="group" aria-label="Cantidad">
        <button class="qty__btn" type="button" data-qty-step="-1" aria-label="Quitar una unidad">−</button>
        <input class="qty__value qty__input" data-qty type="number" inputmode="numeric" min="1" max="${CONFIG.cart.maxQtyPerItem}" value="1" aria-label="Cantidad">
        <button class="qty__btn" type="button" data-qty-step="1" aria-label="Agregar una unidad">+</button>
      </div>
    </div>`;
}

function renderTag(category) {
  const details = product.details?.length ? product.details : [category.label];
  return `
    <aside class="hangtag" aria-label="Detalles">
      <span class="hangtag__hole" aria-hidden="true"></span>
      <img class="hangtag__mark" src="${CONFIG.brand.mark}" alt="Símbolo de Kova" width="72" height="81" loading="lazy">
      <ul class="hangtag__list">${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <span class="hangtag__ref">${productRef(product)}</span>
    </aside>`;
}

/** Bloque de preventa: fechas, precio completo, reserva mínima, contador y cupos (solo datos reales). */
function renderPreorder(state) {
  const info = state.preorder;
  const c = info.campaign;
  if (!c) return '';
  const pct = c.deposit_pct;
  const rows = [
    c.est_dispatch_date && `<div><dt>Despacho estimado</dt><dd>${esc(dateText(c.est_dispatch_date))}</dd></div>`,
    c.est_delivery_date && `<div><dt>Entrega estimada</dt><dd>${esc(dateText(c.est_delivery_date))}</dd></div>`,
    `<div><dt>Precio completo</dt><dd>${formatPrice(product.price)}</dd></div>`,
    pct >= 100 && `<div><dt>Pago</dt><dd>Completo al reservar</dd></div>`,
    pct < 100 && `<div><dt>${c.allow_full_payment ? 'Reserva mínima' : 'Anticipo'} (${pct}%)</dt><dd>${formatPrice(depositOf(product.price, pct))}</dd></div>`,
    pct < 100 && `<div><dt>Saldo</dt><dd>Se paga antes del despacho${c.allow_full_payment ? ' · también puedes pagar el 100%' : ''}</dd></div>`,
    c.show_availability && Number.isInteger(info.remaining) && `<div><dt>Cupos disponibles</dt><dd data-remaining>${info.remaining}</dd></div>`,
  ].filter(Boolean).join('');
  const target = info.phase === 'scheduled' ? c.opens_at : info.phase === 'open' ? c.closes_at : null;
  return `
    <section class="preorder s-navy" aria-labelledby="pre-title">
      <p class="preorder__eyebrow"><span class="tag tag--pre">Preventa</span> ${esc(c.drop_name || c.name)}</p>
      <h2 class="preorder__title" id="pre-title">${{ open: 'Reserva tu pieza.', scheduled: 'La preventa abre pronto.', sold_out: 'Cupos agotados.', paused: 'Preventa en pausa.', closed: 'Preventa cerrada.' }[info.phase] ?? 'Preventa cerrada.'}</h2>
      ${c.show_countdown && target ? `<div class="countdown" data-countdown="${esc(target)}" data-phase="${info.phase}" role="timer" aria-live="off">
        <span class="countdown__label">${info.phase === 'scheduled' ? 'Abre en' : 'Cierra en'}</span>
        <span class="countdown__val" data-cd></span></div>` : ''}
      <dl class="preorder__facts">${rows}</dl>
      <p class="preorder__notice"><i class="ico ico--destellos" aria-hidden="true"></i><span>Este producto se fabrica para la preventa: <b>no está listo para despacho inmediato</b>. Tu reserva se confirma cuando KOVA verifica tu pago.</span></p>
      ${c.terms ? `<details class="preorder__terms"><summary>Condiciones de esta preventa</summary><p>${esc(c.terms).replace(/\n/g, '<br>')}</p></details>` : ''}
    </section>`;
}

/** Contador regresivo con la hora del servidor. Al llegar a cero recarga para mostrar el estado real. */
function startCountdown(root) {
  const el = root.querySelector('[data-countdown]');
  if (!el) return;
  const end = Date.parse(el.dataset.countdown);
  const out = el.querySelector('[data-cd]');
  const tick = () => {
    const ms = end - serverNow();
    if (ms <= 0) { out.textContent = '00:00:00'; clearInterval(timer); setTimeout(() => location.reload(), 1500); return; }
    const d = Math.floor(ms / 86400000); const h = Math.floor(ms / 3600000) % 24; const m = Math.floor(ms / 60000) % 60; const sec = Math.floor(ms / 1000) % 60;
    out.textContent = `${d ? `${d}d ` : ''}${pad(h, 2)}:${pad(m, 2)}:${pad(sec, 2)}`;
  };
  const timer = setInterval(tick, 1000);
  tick();
}

function renderProduct() {
  const category = getCategory(product.category);
  const state = purchaseState(product);
  const pre = state.mode === 'preorder';
  const soldOut = !state.canBuy;
  document.title = `${product.name} — ${CONFIG.brand.name}`;
  document.querySelector('meta[name="description"]')?.setAttribute('content', product.description);

  const related = getRelated(product);
  main.innerHTML = `
    <section class="pdp s-navy">
      <div class="container">
        <nav class="crumbs" aria-label="Ruta">
          <a href="index.html">Inicio</a><i class="ico ico--destellos" aria-hidden="true"></i>
          <a href="index.html#${category.id}">${esc(category.label)}</a><i class="ico ico--destellos" aria-hidden="true"></i>
          <span aria-current="page">${esc(product.name)}</span>
        </nav>
        <div class="pdp__grid">
          ${renderGallery()}
          <div class="pdp__info">
            <div class="pdp__top">
              <p class="eyebrow">${esc(category.label)} // ${productRef(product)}</p>
              ${pre ? '<span class="tag tag--pre">Pre-order</span>' : product.tag && !soldOut ? `<span class="tag">${esc(product.tag)}</span>` : ''}
            </div>
            <h1 class="pdp__name">${esc(product.name)}<span class="dot">.</span></h1>
            <div class="pdp__priceRow">
              <p class="pdp__price">${formatPrice(product.price)}</p>
              <span class="status ${soldOut ? 'status--off' : 'status--on'}">${esc(state.label)}</span>
            </div>
            <p class="pdp__desc">${esc(product.description)}</p>
            ${pre ? renderPreorder(state) : ''}
            ${soldOut ? '' : renderColors() + renderSizes(pre) + renderQty()}
            <button class="btn btn--primary btn--xl btn--block pdp__cta" type="button" ${soldOut ? 'data-contact' : 'data-add'}>
              ${soldOut ? (pre || state.mode === 'coming_soon' ? 'Avísame por WhatsApp' : 'Preguntar por reposición') : `<span data-add-label>${pre ? 'Reservar ahora' : 'Añadir al carrito'}</span>`} <i class="ico ico--destellos" aria-hidden="true"></i>
            </button>
            <p class="pdp__note"><i class="ico ico--orbita" aria-hidden="true"></i> ${pre ? 'Agrega tu reserva al carrito y elige anticipo o pago completo al finalizar.' : 'Arma tu pedido en el carrito y finaliza la compra en pocos pasos.'}</p>
            ${renderTag(category)}
          </div>
        </div>
      </div>
    </section>
    ${related.length ? `
    <section class="section s-arena">
      <div class="container">
        ${chapter({ num: category.code, title: 'También te puede gustar', note: category.label, folio: `${pad(related.length, 2)} piezas` })}
        ${productGrid(related)}
      </div>
    </section>` : ''}
    <div class="sticky-cta s-navy">
      <div><strong>${esc(product.name)}</strong><span>${formatPrice(product.price)}</span></div>
      <button class="btn btn--primary btn--sm" type="button" ${soldOut ? 'data-contact' : 'data-add'}>${soldOut ? 'Preguntar' : pre ? 'Reservar' : 'Añadir'} <span class="btn__arrow" aria-hidden="true">${soldOut ? '→' : '+'}</span></button>
    </div>`;

  // Agotado: se conserva el modal de contacto (WhatsApp) para preguntar por reposición.
  if (soldOut) {
    const openModal = createContactModal(product);
    main.querySelectorAll('[data-contact]').forEach((btn) => btn.addEventListener('click', () => openModal()));
  }

  const sizes = main.querySelector('[data-sizes]');
  const colors = main.querySelector('[data-colors]');
  const chosenSize = () => sizes?.querySelector('input:checked')?.value ?? null;
  const chosenColor = () => colors?.querySelector('input:checked')?.value ?? null;

  const flagMissing = (group, hintSel, text) => {
    group.scrollIntoView({ behavior: 'smooth', block: 'center' });
    group.classList.remove('is-error');
    void group.offsetWidth; // reinicia la animación
    group.classList.add('is-error');
    main.querySelector(hintSel).textContent = text;
    group.querySelector('input:not([disabled])')?.focus({ preventScroll: true });
  };

  const addLabel = main.querySelector('[data-add-label]');
  main.querySelectorAll('[data-add]').forEach((btn) => btn.addEventListener('click', () => {
    // Si el producto tiene colores o tallas, primero hay que elegirlos.
    if (colors && !chosenColor()) return flagMissing(colors, '[data-color-hint]', 'Elige un color para continuar');
    if (sizes && !chosenSize()) return flagMissing(sizes, '[data-size-hint]', 'Elige una talla para continuar');
    const size = chosenSize();
    const color = chosenColor();
    const qty = Number(main.querySelector('[data-qty]')?.value) || 1;
    if (pre) {
      const v = state.preorder.variantInfo(size, color);
      if (!v.enabled) return toast('Esta combinación de talla y color no participa en la preventa.');
      if (Number.isInteger(v.remaining) && v.remaining < qty) return toast(v.remaining ? `Solo quedan ${v.remaining} cupos de esta talla y color.` : 'Esta talla y color ya no tienen cupos.');
    }
    const result = addItem(product.id, { size, color, qty });
    if (!result.ok) return toast('Esta variante no está disponible.');
    const variant = [size && `talla ${size}`, color && color.toLowerCase()].filter(Boolean).join(', ');
    toast(result.capped
      ? `Máximo ${CONFIG.cart.maxQtyPerItem} unidades por variante en un pedido.`
      : `Añadido al carrito: ${product.name}${variant ? ` (${variant})` : ''} · ${result.qty} en el carrito.`);
    // Confirmación en el propio botón.
    addLabel.textContent = 'Añadido ✓';
    clearTimeout(addLabel.timer);
    addLabel.timer = setTimeout(() => { addLabel.textContent = pre ? 'Reservar ahora' : 'Añadir al carrito'; }, 1600);
  }));
  sizes?.addEventListener('change', () => {
    sizes.classList.remove('is-error');
    main.querySelector('[data-size-hint]').textContent = `Talla ${chosenSize()} seleccionada`;
  });
  colors?.addEventListener('change', () => {
    colors.classList.remove('is-error');
    main.querySelector('[data-color-hint]').textContent = `${chosenColor()} seleccionado`;
  });

  main.querySelector('[data-qty-group]')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-qty-step]');
    if (!b) return;
    const input = main.querySelector('[data-qty]');
    input.value = Math.min(Number(input.max), Math.max(1, (Number(input.value) || 1) + Number(b.dataset.qtyStep)));
  });
  startCountdown(main);

  // Galería: miniaturas y deslizamiento en móvil.
  const imgs = [...main.querySelectorAll('.gallery__img')];
  const thumbs = [...main.querySelectorAll('.gallery__thumb')];
  const counter = main.querySelector('[data-current]');
  let current = 0;
  const show = (i) => {
    current = (i + imgs.length) % imgs.length;
    imgs.forEach((img, n) => img.classList.toggle('is-active', n === current));
    thumbs.forEach((t, n) => { t.classList.toggle('is-active', n === current); t.setAttribute('aria-pressed', String(n === current)); });
    if (counter) counter.textContent = pad(current + 1, 2);
  };
  thumbs.forEach((t) => t.addEventListener('click', () => show(+t.dataset.index)));
  if (imgs.length > 1) {
    let x0 = null;
    const stage = main.querySelector('.gallery__main');
    stage.addEventListener('touchstart', (e) => { x0 = e.touches[0].clientX; }, { passive: true });
    stage.addEventListener('touchend', (e) => {
      if (x0 === null) return;
      const dx = e.changedTouches[0].clientX - x0;
      if (Math.abs(dx) > 40) show(current + (dx < 0 ? 1 : -1));
      x0 = null;
    });
  }

  // La barra fija de compra (móvil) aparece cuando el botón principal sale de pantalla.
  const sticky = main.querySelector('.sticky-cta');
  const cta = main.querySelector('.pdp__cta');
  const updateSticky = () => {
    const visible = cta.getBoundingClientRect().bottom < 0;
    sticky.classList.toggle('is-visible', visible);
    // El botón flotante del carrito sube para no tapar la barra.
    document.body.classList.toggle('has-sticky-cta', visible);
  };
  addEventListener('scroll', updateSticky, { passive: true });
  updateSticky();
}

product ? renderProduct() : renderNotFound();
mountLayout();
