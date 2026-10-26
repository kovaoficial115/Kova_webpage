import { getProductById, getCategory, getRelated, isAvailable } from '../services/catalog.js';
import { productGrid, productRef } from '../components/productCard.js';
import { createContactModal } from '../components/contactModal.js';
import { chapter } from '../components/chapter.js';
import { mountLayout } from '../components/layout.js';
import { formatPrice, pad } from '../utils/format.js';
import { esc, toast } from '../utils/dom.js';
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
        <button type="button" class="gallery__thumb${i === 0 ? ' is-active' : ''}" data-index="${i}" aria-label="Ver imagen ${i + 1}" aria-pressed="${i === 0}">
          <img src="${src}" alt="" width="160" height="200" loading="lazy">
        </button>`).join('')}</div>`
    : '';
  return `
    <div class="gallery">
      <div class="gallery__main">
        ${product.images.map((src, i) => `
          <img class="gallery__img${i === 0 ? ' is-active' : ''}" src="${src}" alt="${esc(product.name)}${many ? ` — imagen ${i + 1}` : ''}" width="800" height="1000"${i === 0 ? ' fetchpriority="high"' : ' loading="lazy"'}>`).join('')}
        <span class="gallery__count" aria-hidden="true">${many ? `<b data-current>01</b> / ${pad(product.images.length, 2)}` : ''}</span>
      </div>
      ${thumbs}
    </div>`;
}

function renderSizes() {
  if (!product.sizes?.length) return '';
  const out = product.soldOutSizes ?? [];
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

function renderTag(category) {
  const details = product.details?.length ? product.details : [category.label];
  return `
    <aside class="hangtag" aria-label="Detalles">
      <span class="hangtag__hole" aria-hidden="true"></span>
      <img class="hangtag__mark" src="${CONFIG.brand.mark}" alt="" width="72" height="81" loading="lazy">
      <ul class="hangtag__list">${details.map((d) => `<li>${esc(d)}</li>`).join('')}</ul>
      <span class="hangtag__ref">${productRef(product)}</span>
    </aside>`;
}

function renderProduct() {
  const category = getCategory(product.category);
  const soldOut = !isAvailable(product);
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
              ${product.tag && !soldOut ? `<span class="tag">${esc(product.tag)}</span>` : ''}
            </div>
            <h1 class="pdp__name">${esc(product.name)}<span class="dot">.</span></h1>
            <div class="pdp__priceRow">
              <p class="pdp__price">${formatPrice(product.price)}</p>
              <span class="status ${soldOut ? 'status--off' : 'status--on'}">${soldOut ? 'Agotado' : 'Disponible'}</span>
            </div>
            <p class="pdp__desc">${esc(product.description)}</p>
            ${soldOut ? '' : renderColors() + renderSizes()}
            <button class="btn btn--primary btn--xl btn--block pdp__cta" type="button" ${soldOut ? 'data-contact' : 'data-add'}>
              ${soldOut ? 'Preguntar por reposición' : '<span data-add-label>Añadir al carrito</span>'} <i class="ico ico--destellos" aria-hidden="true"></i>
            </button>
            <p class="pdp__note"><i class="ico ico--orbita" aria-hidden="true"></i> Arma tu pedido en el carrito y envíalo por WhatsApp.</p>
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
      <button class="btn btn--primary btn--sm" type="button" ${soldOut ? 'data-contact' : 'data-add'}>${soldOut ? 'Preguntar' : 'Añadir'} <span class="btn__arrow" aria-hidden="true">${soldOut ? '→' : '+'}</span></button>
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
    const result = addItem(product.id, { size, color });
    if (!result.ok) return toast('Esta variante no está disponible.');
    const variant = [size && `talla ${size}`, color && color.toLowerCase()].filter(Boolean).join(', ');
    toast(result.capped
      ? `Máximo ${CONFIG.cart.maxQtyPerItem} unidades por variante en un pedido.`
      : `Añadido al carrito: ${product.name}${variant ? ` (${variant})` : ''} · ${result.qty} en el carrito.`);
    // Confirmación en el propio botón.
    addLabel.textContent = 'Añadido ✓';
    clearTimeout(addLabel.timer);
    addLabel.timer = setTimeout(() => { addLabel.textContent = 'Añadir al carrito'; }, 1600);
  }));
  sizes?.addEventListener('change', () => {
    sizes.classList.remove('is-error');
    main.querySelector('[data-size-hint]').textContent = `Talla ${chosenSize()} seleccionada`;
  });
  colors?.addEventListener('change', () => {
    colors.classList.remove('is-error');
    main.querySelector('[data-color-hint]').textContent = `${chosenColor()} seleccionado`;
  });

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
