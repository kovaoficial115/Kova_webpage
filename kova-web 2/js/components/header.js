import { CONFIG } from '../config.js';
import { esc } from '../utils/dom.js';
import { bagIcon } from './cartPanel.js';

const MARQUEE_ITEMS = [
  'Compra directo por Instagram',
  `@${CONFIG.instagram.handle}`,
  CONFIG.brand.tagline,
  'Drop 01 disponible',
  'Hecho en Colombia',
];

function marquee() {
  const row = MARQUEE_ITEMS.map((t) => `<span>${esc(t)}</span><i class="ico ico--destellos" aria-hidden="true"></i>`).join('');
  // El contenido se duplica para que el desplazamiento sea continuo.
  return `
    <div class="marquee" aria-label="Anuncios">
      <div class="marquee__track"><div class="marquee__group">${row}</div><div class="marquee__group" aria-hidden="true">${row}</div></div>
    </div>`;
}

export function renderHeader() {
  const links = [
    { href: 'index.html#destacados', label: 'Destacados' },
    { href: 'index.html#catalogo', label: 'Catálogo' },
    { href: 'index.html#como-comprar', label: 'Cómo comprar' },
    { href: 'index.html#contacto', label: 'Contacto' },
  ];
  const nav = links.map((l, i) => `
    <li style="--i:${i}"><a href="${l.href}"><span class="nav__num">${String(i + 1).padStart(2, '0')}</span><span class="nav__label">${esc(l.label)}</span></a></li>`).join('');

  return `
    ${marquee()}
    <div class="header__bar">
      <a class="header__logo" href="index.html" aria-label="${esc(CONFIG.brand.name)} Streetwear — inicio">
        <img src="${CONFIG.brand.logo}" alt="${esc(CONFIG.brand.name)} Streetwear" width="640" height="262">
      </a>
      <nav class="nav" id="site-nav" aria-label="Principal">
        <ul class="nav__list">${nav}</ul>
        <a class="btn btn--light btn--sm nav__cta" href="${CONFIG.instagram.profileUrl}" target="_blank" rel="noopener">
          Instagram <span class="btn__arrow" aria-hidden="true">↗</span>
        </a>
        <p class="nav__foot" aria-hidden="true"><span>${esc(CONFIG.brand.tagline)}</span><span>@${esc(CONFIG.instagram.handle)}</span></p>
      </nav>
      <a class="header__cart is-empty" href="carrito.html" data-cart-link aria-label="Carrito vacío"${document.body.dataset.page === 'cart' ? ' aria-current="page"' : ''}>
        ${bagIcon()}<span class="header__cartLabel">Carrito</span><span class="header__cartCount" data-cart-count hidden>0</span>
      </a>
      <button class="header__toggle" type="button" aria-controls="site-nav" aria-expanded="false" aria-label="Abrir menú">
        <span></span><span></span>
      </button>
    </div>`;
}

export function initHeader(root) {
  const toggle = root.querySelector('.header__toggle');
  const setOpen = (open) => {
    root.classList.toggle('is-open', open);
    document.body.classList.toggle('no-scroll', open);
    toggle.setAttribute('aria-expanded', String(open));
    toggle.setAttribute('aria-label', open ? 'Cerrar menú' : 'Abrir menú');
  };
  toggle.addEventListener('click', () => setOpen(!root.classList.contains('is-open')));
  root.querySelectorAll('.nav a').forEach((a) => a.addEventListener('click', () => setOpen(false)));
  document.addEventListener('keydown', (e) => e.key === 'Escape' && setOpen(false));
  matchMedia('(min-width: 1101px)').addEventListener('change', (e) => e.matches && setOpen(false));

  const links = [...root.querySelectorAll('.nav__list a')];

  // La barra se esconde al bajar y vuelve al subir, para dejar más espacio al catálogo.
  let lastY = scrollY;
  addEventListener('scroll', () => {
    const y = scrollY;
    const hide = y > lastY && y > 320 && !root.classList.contains('is-open');
    root.classList.toggle('is-hidden', hide);
    root.classList.toggle('is-scrolled', y > 40);
    if (y < 200) links.forEach((a) => a.classList.remove('is-active'));
    lastY = y;
  }, { passive: true });

  // Marca el enlace de la sección visible.
  const sections = links.map((a) => document.getElementById(a.hash.slice(1))).filter(Boolean);
  if (!sections.length || !('IntersectionObserver' in window)) return;
  const io = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      links.forEach((a) => a.classList.toggle('is-active', a.hash === `#${entry.target.id}`));
    });
  }, { rootMargin: '-45% 0px -50% 0px' });
  sections.forEach((s) => io.observe(s));
}
