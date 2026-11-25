/** Condiciones de compra (condiciones.html): textos editables desde /admin → Configuración. */
import { mountLayout } from '../components/layout.js';
import { chapter } from '../components/chapter.js';
import { getLegal } from '../services/storefront.js';
import '../services/catalog.js';
import { legalDefaults } from '../data/legal.js';
import { esc } from '../utils/dom.js';

const main = document.querySelector('main');
const saved = getLegal();
const legal = saved?.sections?.length ? saved : legalDefaults;
main.innerHTML = `
  <section class="section s-arena legalpage">
    <div class="container">
      <nav class="crumbs" aria-label="Ruta"><a href="index.html">Inicio</a><i class="ico ico--destellos" aria-hidden="true"></i><span aria-current="page">Condiciones</span></nav>
      ${chapter({ num: 'KV', title: 'Condiciones de compra', note: 'Compra, preventa, envíos, garantía, retracto y datos personales', folio: 'Legal' })}
      ${legal.reviewed ? '' : '<p class="legal__draft" role="note">Textos en revisión por KOVA. Ante cualquier duda escríbenos por WhatsApp antes de comprar.</p>'}
      <nav class="legal__toc" aria-label="Secciones"><ol>${legal.sections.map((s) => `<li><a href="#${esc(s.id)}">${esc(s.title)}</a></li>`).join('')}</ol></nav>
      ${legal.sections.map((s) => `
        <section class="legal__sec" id="${esc(s.id)}"><h2>${esc(s.title)}</h2>
          ${String(s.body).split(/\n+/).map((p) => `<p>${esc(p)}</p>`).join('')}</section>`).join('')}
      ${saved?.updated_label ? `<p class="legal__updated">Última actualización: ${esc(saved.updated_label)}</p>` : ''}
    </div>
  </section>`;
mountLayout();
if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView();
