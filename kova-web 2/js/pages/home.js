import { CONFIG } from '../config.js';
import { getFeatured, getProducts, getActiveCategories, getByCategory, getCategory } from '../services/catalog.js';
import { productGrid, productUrl } from '../components/productCard.js';
import { chapter } from '../components/chapter.js';
import { mountLayout, initReveal } from '../components/layout.js';
import { esc } from '../utils/dom.js';
import { formatPrice, pad } from '../utils/format.js';

// Números de capítulo en orden de aparición (las secciones que no aplican no dejan huecos).
let chapterCount = 0;
const nextChapter = () => pad(++chapterCount, 2);

const CAMPAIGN = {
  hero: 'assets/img/campana-flatlay.jpg',
  promo: 'assets/img/campana-posters.jpg',
};

function renderHero() {
  const [main] = getFeatured();
  const cats = getActiveCategories();
  return `
    <section class="hero s-navy">
      <div class="container">
        <div class="hero__frame grid-lines">
          <div class="hero__copy">
            <p class="eyebrow hero__eyebrow">Drop 01 // ${esc(CONFIG.brand.tagline)}</p>
            <h1 class="hero__title"><span>Hecho</span> <span>para</span> <span>destacar<span class="dot">.</span></span></h1>
            <p class="hero__lead">Camisetas con carácter propio. Diseño gráfico colombiano para quienes no buscan encajar, sino mostrar quiénes son.</p>
            <div class="hero__actions">
              <a class="btn btn--primary btn--xl" href="#catalogo">Ver catálogo <i class="ico ico--destellos" aria-hidden="true"></i></a>
              <a class="btn btn--line btn--xl" href="${CONFIG.instagram.profileUrl}" target="_blank" rel="noopener">Instagram <span class="btn__arrow" aria-hidden="true">↗</span></a>
            </div>
            <dl class="hero__stats">
              ${cats.map((c) => `<div><dt>${esc(c.label)}</dt><dd>${pad(getByCategory(c.id).length, 2)}</dd></div>`).join('')}
              <div><dt>Compra</dt><dd>DM</dd></div>
            </dl>
          </div>

          <div class="hero__visual">
            <div class="hero__pattern" aria-hidden="true"></div>
            <figure class="hero__photo">
              <img src="${CAMPAIGN.hero}" alt="Camiseta Kova azul marino sobre concreto con gorra y stickers" width="1200" height="1500" fetchpriority="high">
            </figure>
            <i class="ico ico--destellos hero__spark twinkle" aria-hidden="true"></i>
            <i class="ico ico--destellos hero__spark hero__spark--b twinkle twinkle--late" aria-hidden="true"></i>
            <div class="seal hero__seal" aria-hidden="true">
              <svg viewBox="0 0 100 100"><defs><path id="seal-path" d="M50 50m-37 0a37 37 0 1 1 74 0a37 37 0 1 1-74 0"/></defs>
                <text><textPath href="#seal-path" textLength="230" lengthAdjust="spacing">DISEÑO STREETWEAR • HECHO EN COLOMBIA •</textPath></text></svg>
              <i class="ico ico--estrella"></i>
            </div>
            ${main ? `
            <a class="hero__pick" href="${productUrl(main)}">
              <img src="${main.images[0]}" alt="" width="800" height="1000">
              <span><small>En el drop</small><strong>${esc(main.name)}</strong><em>${formatPrice(main.price)}</em></span>
              <span class="btn__arrow" aria-hidden="true">→</span>
            </a>` : ''}
          </div>
        </div>
      </div>
    </section>`;
}

function renderCategories() {
  const cats = getActiveCategories();
  // Con una sola línea de producto (hoy: camisetas) la sección no aporta nada: el catálogo ya es esa línea.
  if (cats.length < 2) return '';
  const tiles = cats.map((c, i) => {
    const items = getByCategory(c.id);
    return `
      <a class="tile reveal" style="--i:${i}" href="#${c.id}" >
        <img src="${c.cover ?? items[0].images[0]}" alt="" width="1000" height="1250" loading="lazy" decoding="async">
        <span class="tile__top"><span class="tag tag--navy">${esc(c.code)}</span><span>${pad(items.length, 2)} productos</span></span>
        <span class="tile__bottom">
          <span class="tile__label">${esc(c.label)}</span>
          <span class="tile__cta">Ver todo <i class="ico ico--conector-4 ico--wide" aria-hidden="true"></i></span>
        </span>
      </a>`;
  }).join('');
  return `
    <section class="section s-arena" id="categorias">
      <div class="container">
        ${chapter({ num: nextChapter(), title: 'Categorías', note: 'Explora por tipo de producto', folio: `${pad(cats.length, 2)} líneas` })}
        <div class="tiles">${tiles}</div>
      </div>
    </section>`;
}

function renderFeatured() {
  const items = getFeatured();
  if (!items.length) return '';
  return `
    <section class="section s-navy" id="destacados">
      <div class="container">
        ${chapter({ num: nextChapter(), title: 'Destacados', note: 'Lo más buscado del drop', folio: `${pad(items.length, 2)} piezas` })}
        ${productGrid(items)}
      </div>
    </section>`;
}

function renderPromo() {
  return `
    <section class="promo s-navy" aria-label="Drop 01">
      <div class="promo__pattern" aria-hidden="true"></div>
      <div class="container promo__inner">
        <figure class="promo__photo reveal">
          <img src="${CAMPAIGN.promo}" alt="Muro con afiches de lanzamiento Kova Drop 01" width="1200" height="1500" loading="lazy" decoding="async">
        </figure>
        <div class="promo__copy reveal" style="--i:1">
          <span class="tag promo__tag">No va a pasar desapercibido</span>
          <h2 class="promo__title">Drop 01<br>ya está en la calle<span class="dot">.</span></h2>
          <p>Piezas pensadas para destacar y vestir lo que realmente te representa. Unidades limitadas por diseño.</p>
          <a class="btn btn--light btn--xl" href="#destacados">Ver el drop <i class="ico ico--destellos" aria-hidden="true"></i></a>
        </div>
      </div>
    </section>`;
}

function renderCatalog() {
  const cats = getActiveCategories();
  const all = getProducts().filter((p) => cats.some((c) => c.id === p.category));
  const tabs = [{ id: 'all', label: 'Todo', count: all.length }, ...cats.map((c) => ({ id: c.id, label: c.label, count: getByCategory(c.id).length }))];
  return `
    <section class="section s-arena" id="catalogo">
      <div class="container">
        ${chapter({ num: nextChapter(), title: 'Catálogo', note: 'Todo lo disponible, en un solo lugar', folio: `${pad(all.length, 2)} productos` })}
        ${cats.length < 2 ? '' : `<div class="filters reveal" role="tablist" aria-label="Filtrar por categoría">
          ${tabs.map((t, i) => `
            <button class="filter${i === 0 ? ' is-active' : ''}" type="button" role="tab" aria-selected="${i === 0}" data-filter="${t.id}">
              ${esc(t.label)} <span class="filter__count">${pad(t.count, 2)}</span>
            </button>`).join('')}
        </div>`}
        <p class="catalog__blurb" data-blurb>Camisetas con la identidad de Kova.</p>
        <div data-catalog-grid>${productGrid(all)}</div>
      </div>
    </section>`;
}

function renderSteps() {
  const steps = [
    ['Elige', 'Abre la camiseta que te guste, elige tu talla y añádela al carrito.', 'destellos'],
    ['Escríbenos', 'En el carrito escribe tu nombre y teléfono, pulsa “Finalizar compra” y envíanos el pedido por Instagram.', 'orbita'],
    ['Recíbelo', 'Acordamos pago y envío directamente por mensaje.', 'globo'],
  ];
  return `
    <section class="section s-navy" id="como-comprar">
      <div class="container">
        ${chapter({ num: nextChapter(), title: 'Cómo comprar', note: 'Arma tu carrito y envíanos el pedido por Instagram', folio: '03 pasos' })}
        <ol class="steps">
          ${steps.map(([t, d, ico], i) => `
            <li class="step reveal" style="--i:${i}">
              <span class="step__num" aria-hidden="true">${pad(i + 1, 2)}</span>
              <i class="ico ico--${ico} step__ico" aria-hidden="true"></i>
              <h3 class="step__title">${t}</h3>
              <p>${d}</p>
            </li>`).join('')}
        </ol>
      </div>
    </section>`;
}

function renderContact() {
  return `
    <section class="contact s-navy" id="contacto">
      <div class="contact__pattern" aria-hidden="true"></div>
      <div class="container contact__inner reveal">
        <p class="eyebrow">Contacto</p>
        <h2 class="contact__title">¿Lo quieres?<br>Escríbenos<span class="dot">.</span></h2>
        <p class="contact__lead">Todas las compras y preguntas se atienden por Instagram. Te respondemos directo, sin vueltas.</p>
        <div class="contact__actions">
          <a class="btn btn--primary btn--xl" href="${CONFIG.instagram.contactUrl}" target="_blank" rel="noopener">Escríbenos por Instagram <span class="btn__arrow" aria-hidden="true">↗</span></a>
          <a class="contact__handle" href="${CONFIG.instagram.profileUrl}" target="_blank" rel="noopener">@${esc(CONFIG.instagram.handle)}</a>
        </div>
      </div>
    </section>`;
}

document.querySelector('main').innerHTML = [
  renderHero(),
  renderCategories(),
  renderFeatured(),
  renderPromo(),
  renderCatalog(),
  renderSteps(),
  renderContact(),
].join('');

mountLayout();

/* ---------- Filtro del catálogo ----------
 * Los enlaces #<categoría> (menú, tarjetas de categoría, pie) abren el catálogo filtrado. */
const catalog = document.getElementById('catalogo');
const gridSlot = catalog.querySelector('[data-catalog-grid]');
const blurb = catalog.querySelector('[data-blurb]');
const defaultBlurb = blurb.textContent;

function applyFilter(id, { scroll = false } = {}) {
  const valid = id === 'all' || getActiveCategories().some((c) => c.id === id);
  const filter = valid ? id : 'all';
  catalog.querySelectorAll('[data-filter]').forEach((b) => {
    const on = b.dataset.filter === filter;
    b.classList.toggle('is-active', on);
    b.setAttribute('aria-selected', String(on));
  });
  const items = filter === 'all'
    ? getProducts().filter((p) => getActiveCategories().some((c) => c.id === p.category))
    : getByCategory(filter);
  blurb.textContent = filter === 'all' ? defaultBlurb : getCategory(filter).blurb;
  gridSlot.classList.add('is-swapping');
  setTimeout(() => {
    gridSlot.innerHTML = productGrid(items);
    gridSlot.classList.remove('is-swapping');
    initReveal(gridSlot);
  }, scroll ? 0 : 180);
  if (scroll) catalog.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

catalog.querySelectorAll('[data-filter]').forEach((btn) => btn.addEventListener('click', () => {
  const id = btn.dataset.filter;
  history.replaceState(null, '', id === 'all' ? '#catalogo' : `#${id}`);
  applyFilter(id);
}));

function handleHash() {
  const id = decodeURIComponent(location.hash.slice(1));
  if (!id) return;
  if (getCategory(id)) return applyFilter(id, { scroll: true });
  document.getElementById(id)?.scrollIntoView();
}
addEventListener('hashchange', handleHash);
// Repetir el mismo #enlace no dispara hashchange: se atienden los clics directamente.
document.addEventListener('click', (e) => {
  const a = e.target.closest('a[href*="#"]');
  if (!a || a.pathname !== location.pathname) return;
  const id = decodeURIComponent(a.hash.slice(1));
  if (!getCategory(id)) return;
  e.preventDefault();
  history.replaceState(null, '', `#${id}`);
  applyFilter(id, { scroll: true });
});
// Si se llegó con un #ancla (p. ej. desde la página de producto), desplazarse una vez que el contenido existe.
handleHash();
