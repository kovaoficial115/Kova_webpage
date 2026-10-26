import { CONFIG } from '../config.js';
import { getActiveCategories } from '../services/catalog.js';
import { esc } from '../utils/dom.js';

export function renderFooter() {
  const cats = getActiveCategories().map((c) => `<li><a href="index.html#${c.id}">${esc(c.label)}</a></li>`).join('');
  return `
    <div class="footer__pattern" aria-hidden="true"></div>
    <div class="container">
      <div class="footer__frame grid-lines">
        <div class="footer__brand">
          <img src="${CONFIG.brand.logo}" alt="${esc(CONFIG.brand.name)} Streetwear" width="640" height="262" loading="lazy">
          <p>Diseño streetwear colombiano para quienes usan la ropa como una forma de mostrar quiénes son.</p>
        </div>
        <div class="footer__col">
          <h3 class="footer__title">Catálogo</h3>
          <ul class="footer__list"><li><a href="index.html#destacados">Destacados</a></li>${cats}<li><a href="index.html#como-comprar">Cómo comprar</a></li></ul>
        </div>
        <div class="footer__col">
          <h3 class="footer__title">Contacto</h3>
          <ul class="footer__list">
            <li><a href="https://wa.me/${CONFIG.whatsapp.number}" target="_blank" rel="noopener">WhatsApp ${esc(CONFIG.whatsapp.display)}</a></li>
            <li><a href="${CONFIG.instagram.profileUrl}" target="_blank" rel="noopener">Instagram @${esc(CONFIG.instagram.handle)}</a></li>
            <li><a href="${CONFIG.instagram.contactUrl}" target="_blank" rel="noopener">Mensaje directo en Instagram</a></li>
            <li class="footer__mail">
              <a href="mailto:${esc(CONFIG.contactEmail)}">${esc(CONFIG.contactEmail)}</a>
              <small>Colaboraciones, propuestas y consultas generales. Los pedidos se hacen por WhatsApp.</small>
            </li>
          </ul>
          <p class="footer__made"><i class="ico ico--globo" aria-hidden="true"></i> Hecho en Colombia</p>
        </div>
      </div>
      <div class="folio footer__folio">
        <span>${esc(CONFIG.brand.name)}</span>
        <span>${esc(CONFIG.brand.tagline)}</span>
        <span>© ${new Date().getFullYear()}</span>
      </div>
    </div>`;
}
