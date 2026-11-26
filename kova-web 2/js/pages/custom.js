/**
 * KOVA CUSTOM — YOUR DESIGN. YOUR IDENTITY. (custom.html)
 *
 * Flujo: color → talla → estampado → precio → (opcional) previsualizar el diseño → carrito.
 * El diseño que el cliente elige sirve para previsualizar y es el archivo original del pedido.
 *
 * Privacidad y arquitectura: mientras el cliente compra, el archivo se queda en su navegador
 * (URL.createObjectURL para la vista previa e IndexedDB para guardarlo, services/designStore.js).
 * Solo cuando el pedido queda registrado, la página del pedido lo sube al bucket PRIVADO de KOVA
 * usando el enlace privado del pedido. Al carrito pasa el nombre del archivo y una miniatura.
 *
 * Toda regla (precios, medidas, colores, tallas, inventario) viene de services/custom.js.
 */
import { CONFIG } from '../config.js';
import { mountLayout } from '../components/layout.js';
import { chapter } from '../components/chapter.js';
import { teeSvg, isLight } from '../components/teeMockup.js';
import {
  getModes, getMode, getColors, getColor, getSizes, modeZones, zoneOnFace, cmText, modeMeasures,
  stockOf, isComboAvailable, colorHasStock, priceOf, zoneRect, uploadRules,
} from '../services/custom.js';
import { addCustomItem } from '../services/cart.js';
import { saveDesigns, pruneOldDesigns } from '../services/designStore.js';
import { esc, toast } from '../utils/dom.js';
import { formatPrice, pad } from '../utils/format.js';

const main = document.querySelector('main');
const MAX_QTY = CONFIG.cart.maxQtyPerItem;
const FACE_NAME = { front: 'Frente', back: 'Espalda' };
const TYPES = { 'image/png': 'PNG', 'image/jpeg': 'JPG', 'image/webp': 'WEBP' };
const EXT = /\.(png|jpe?g|webp)$/i;

/* ---------- Estado ---------- */
const firstColor = getColors().find((c) => colorHasStock(c.id)) ?? getColors()[0];
const state = {
  color: firstColor?.id ?? null,
  size: null,
  mode: getModes()[0]?.id ?? null,
  face: 'front',
  qty: 1,
  active: null,          // zona seleccionada para mover/escalar
  designs: {},           // zoneId → { name, size, type, url, w, h, scale, ox, oy }
};
const initialMode = getMode(state.mode);
if (initialMode) state.face = modeZones(initialMode)[0].face;

/* ---------- Plantilla ---------- */
function hero() {
  const modes = getModes();
  const from = modes.length ? Math.min(...modes.map((m) => m.price)) : null;
  return `
    <section class="cx-hero s-navy">
      <div class="cx-hero__pattern" aria-hidden="true"></div>
      <div class="container cx-hero__inner">
        <nav class="crumbs" aria-label="Ruta">
          <a href="index.html">Inicio</a><i class="ico ico--destellos" aria-hidden="true"></i>
          <span aria-current="page">KOVA Custom</span>
        </nav>
        <p class="eyebrow">Nuevo · Personalización</p>
        <h1 class="cx-hero__title">KOVA<br>Custom<span class="dot">.</span></h1>
        <p class="cx-hero__claim">Your design. <span>Your identity.</span></p>
        <p class="cx-hero__lead">Tú traes el diseño, nosotros lo estampamos en una camiseta KOVA. Elige color, talla y estampado, mira cómo queda y sube aquí tu archivo original.</p>
        <div class="cx-hero__meta">
          ${from !== null ? `<span class="tag">Desde ${formatPrice(from)}</span>` : ''}
          <span class="cx-hero__note"><i class="ico ico--orbita" aria-hidden="true"></i> Camiseta + estampado incluidos · sin costo por colores</span>
        </div>
        <a class="btn btn--primary btn--xl" href="#studio">Crear mi camiseta <i class="ico ico--destellos" aria-hidden="true"></i></a>
      </div>
    </section>`;
}

function studio() {
  if (!getModes().length || !getColors().length || !getSizes().length) {
    return `
      <section class="section s-arena"><div class="container cx-off">
        <h2>KOVA Custom vuelve pronto<span class="dot">.</span></h2>
        <p>En este momento no hay combinaciones disponibles. Escríbenos por WhatsApp y te contamos cuándo abrimos de nuevo.</p>
        <a class="btn btn--primary" href="https://wa.me/${CONFIG.whatsapp.number}" target="_blank" rel="noopener">Escribir por WhatsApp ↗</a>
      </div></section>`;
  }
  return `
    <section class="cx-studio s-navy" id="studio">
      <div class="container cx-grid">
        <div class="cx-stageCol">
          <div class="cx-stage grid-lines" data-stage>
            <div class="cx-shirt" data-shirt></div>
            <div class="cx-zones" data-zones></div>
            <span class="cx-stage__face" data-face-label></span>
          </div>
          <div class="cx-facebar" role="group" aria-label="Vista de la camiseta" data-facebar>
            <button type="button" data-face="front">Frente</button>
            <button type="button" data-face="back">Espalda</button>
          </div>
          <div class="cx-tools" data-tools hidden></div>
          <p class="cx-stage__hint"><i class="ico ico--destellos" aria-hidden="true"></i> Previsualización aproximada. Tu diseño solo lo ve el equipo de KOVA.</p>
        </div>

        <form class="cx-panel" data-panel novalidate>
          <fieldset class="cx-step" data-step="color">
            <legend class="cx-step__head"><span class="cx-step__num">01</span> Color <span class="cx-step__value" data-color-name></span></legend>
            <div class="sizes__list" data-colors></div>
          </fieldset>

          <fieldset class="cx-step sizes" data-step="size">
            <legend class="cx-step__head"><span class="cx-step__num">02</span> Talla <span class="cx-step__value" data-size-hint>Elige una talla</span></legend>
            <div class="sizes__list" data-sizes></div>
          </fieldset>

          <fieldset class="cx-step" data-step="mode">
            <legend class="cx-step__head"><span class="cx-step__num">03</span> Estampado</legend>
            <div class="cx-modes" data-modes></div>
          </fieldset>

          <div class="cx-step" data-step="design">
            <p class="cx-step__head"><span class="cx-step__num">04</span> Tu diseño <span class="cx-step__value">Archivo original para estampar</span></p>
            <div class="cx-slots" data-slots></div>
            <p class="cx-wa"><i class="ico ico--orbita" aria-hidden="true"></i>
              <span><b>Tu diseño se guarda con tu pedido.</b> Sube aquí el archivo original (PNG con fondo transparente es lo ideal): se envía de forma privada al registrar el pedido y solo lo ve el equipo de KOVA. ¿Lo tienes en PDF o lo subes después? Puedes hacerlo desde la página de tu pedido.</span></p>
            <input type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" hidden data-file>
          </div>

          <div class="cx-buy" data-step="buy">
            <div class="cx-buy__row">
              <div>
                <p class="cx-step__head"><span class="cx-step__num">05</span> Precio</p>
                <p class="cx-price" data-price aria-live="polite"></p>
                <p class="cx-price__detail" data-price-detail></p>
              </div>
              <div class="qty" role="group" aria-label="Cantidad">
                <button class="qty__btn" type="button" data-qty="-1" aria-label="Quitar una unidad">−</button>
                <output class="qty__value" data-qty-value aria-live="polite">1</output>
                <button class="qty__btn" type="button" data-qty="1" aria-label="Agregar una unidad">+</button>
              </div>
            </div>
            <p class="checkout-state status" data-buy-state aria-live="polite"></p>
            <button class="btn btn--primary btn--xl btn--block" type="submit" data-add>
              Agregar al carrito <i class="ico ico--destellos" aria-hidden="true"></i>
            </button>
            <div class="cx-added" data-added hidden></div>
          </div>
        </form>
      </div>
    </section>`;
}

function how() {
  const modes = getModes();
  const steps = [
    ['Personaliza', 'Elige color, talla y tipo de estampado, y sube tu diseño para ver cómo queda en la camiseta.', 'destellos'],
    ['Agrega y finaliza', 'Agrégala al carrito (puedes combinarla con camisetas del catálogo), completa tus datos y elige cómo pagar.', 'orbita'],
    ['Tu diseño llega a KOVA', 'Al registrar el pedido, tus archivos del frente y/o la espalda se suben de forma privada. Si te falta alguno, lo subes desde la página de tu pedido.', 'conector-2'],
    ['Producción', 'Revisamos tu mensaje y tus archivos, confirmamos el pago manualmente y empezamos a estampar.', 'globo'],
  ];
  return `
    <section class="section s-arena cx-how" id="como-funciona">
      <div class="container">
        ${chapter({ num: 'KC', title: 'Cómo funciona', note: 'Tus diseños se suben aquí mismo, de forma privada', folio: `${pad(steps.length, 2)} pasos` })}
        <ol class="cx-flow">
          ${steps.map(([t, d, ico], i) => `
            <li class="cx-flow__item reveal" style="--i:${i}">
              <span class="cx-flow__num" aria-hidden="true">${pad(i + 1, 2)}</span>
              <i class="ico ico--${ico}" aria-hidden="true"></i>
              <h3>${t}</h3><p>${d}</p>
            </li>`).join('')}
        </ol>

        <div class="cx-prices reveal">
          <h3 class="cx-prices__title">Precios KOVA Custom<span class="dot">.</span></h3>
          <table class="cx-table">
            <thead><tr><th scope="col">Modalidad</th><th scope="col">Ubicación</th><th scope="col">Medidas máximas</th><th scope="col">Precio</th></tr></thead>
            <tbody>
              ${modes.map((m) => `<tr><th scope="row">${esc(m.name)}</th><td>${esc(m.label)}</td><td>${esc(modeMeasures(m))}</td><td>${formatPrice(m.price)}</td></tr>`).join('')}
            </tbody>
          </table>
          <ul class="cx-rules">
            <li>El precio incluye la camiseta KOVA y los estampados de la modalidad.</li>
            <li>No cobramos por la cantidad de colores de tu diseño ni por subir una imagen.</li>
            <li>Estampamos diseños que tú nos envías: el servicio no incluye crear el diseño desde cero.</li>
            <li>El pedido se confirma cuando KOVA revisa tu mensaje, tus archivos y tu pago.</li>
          </ul>
        </div>
      </div>
    </section>`;
}

main.innerHTML = hero() + studio() + how();
mountLayout();

const panel = main.querySelector('[data-panel]');
if (panel) initStudio();

/* =========================================================================
 * Estudio
 * ========================================================================= */
function initStudio() {
  const $ = (sel) => main.querySelector(sel);
  const stage = $('[data-stage]');
  const shirt = $('[data-shirt]');
  const zonesBox = $('[data-zones]');
  const tools = $('[data-tools]');
  const fileInput = $('[data-file]');
  let pendingZone = null;

  const mode = () => getMode(state.mode);
  const color = () => getColor(state.color);

  /* ----- Pasos del formulario ----- */
  function renderColors() {
    $('[data-colors]').innerHTML = getColors().map((c) => {
      const out = !colorHasStock(c.id);
      return `
        <label class="size color cx-swatch${out ? ' is-out' : ''}" title="${esc(c.name)}${out ? ' (agotado)' : ''}">
          <input type="radio" name="color" value="${esc(c.id)}"${c.id === state.color ? ' checked' : ''}${out ? ' disabled' : ''}>
          <span style="--swatch:${esc(c.hex)}"><span class="color__name">${esc(c.name)}${out ? ' (agotado)' : ''}</span></span>
        </label>`;
    }).join('');
    $('[data-color-name]').textContent = color()?.name ?? 'Elige un color';
  }

  function renderSizes() {
    $('[data-sizes]').innerHTML = getSizes().map((s) => {
      const ok = isComboAvailable(state.color, s.id);
      const stock = stockOf(state.color, s.id);
      return `
        <label class="size${ok ? '' : ' is-out'}" title="${ok ? (stock !== null && stock <= 3 ? `Quedan ${stock}` : `Talla ${esc(s.id)}`) : 'Agotada'}">
          <input type="radio" name="size" value="${esc(s.id)}"${s.id === state.size ? ' checked' : ''}${ok ? '' : ' disabled'}>
          <span>${esc(s.id)}</span>
        </label>`;
    }).join('');
    const stock = state.size ? stockOf(state.color, state.size) : null;
    $('[data-size-hint]').textContent = !state.size ? 'Elige una talla'
      : stock !== null && stock <= 3 ? `Talla ${state.size} · quedan ${stock}` : `Talla ${state.size}`;
  }

  function renderModes() {
    $('[data-modes]').innerHTML = getModes().map((m) => {
      const zones = modeZones(m);
      return `
        <label class="cx-mode">
          <input type="radio" name="mode" value="${esc(m.id)}"${m.id === state.mode ? ' checked' : ''}>
          <span class="cx-mode__ui">
            <span class="cx-mode__icon" aria-hidden="true">${miniIcons(zones)}</span>
            <span class="cx-mode__text">
              <strong>${esc(m.name)}</strong>
              <span>${esc(m.label)}</span>
              <small>${esc(zones.map(cmText).join(' + '))}</small>
            </span>
            <span class="cx-mode__price">${formatPrice(m.price)}</span>
          </span>
        </label>`;
    }).join('');
  }

  /** Iconos diminutos: silueta frente/espalda con la zona marcada. */
  function miniIcons(zones) {
    return ['front', 'back'].map((face) => {
      const z = zones.find((x) => x.face === face);
      const r = z ? zoneRect(z) : null;
      return `<svg viewBox="0 0 600 700" class="${z ? 'is-on' : ''}"><path d="M206 58 L130 86 L18 192 L76 276 L132 246 L128 656 Q300 676 472 656 L468 246 L524 276 L582 192 L470 86 L394 58 Z"/>${r ? `<rect x="${r.left * 6}" y="${r.top * 7}" width="${r.width * 6}" height="${r.height * 7}"/>` : ''}</svg>`;
    }).join('');
  }

  function renderSlots() {
    const m = mode();
    $('[data-slots]').innerHTML = modeZones(m).map((z) => {
      const d = state.designs[z.id];
      const check = d ? quality(z, d) : null;
      return `
        <div class="cx-slot${d ? ' has-file' : ''}${state.active === z.id ? ' is-active' : ''}" data-slot="${esc(z.id)}">
          <div class="cx-slot__head">
            <span class="cx-slot__face">${FACE_NAME[z.face]}</span>
            <span class="cx-slot__zone">${esc(z.label)} · máx. ${esc(cmText(z))}</span>
          </div>
          ${d ? `
            <div class="cx-slot__file">
              <img src="${d.url}" alt="" width="56" height="56">
              <span><b>${esc(d.name)}</b><small>${TYPES[d.type] ?? 'Imagen'} · ${d.w} × ${d.h} px · ${fmtBytes(d.size)}</small></span>
            </div>
            <p class="cx-check cx-check--${check.level}" data-check="${esc(z.id)}">${esc(check.text)}</p>
            <div class="cx-slot__actions">
              <button type="button" class="cx-mini" data-edit="${esc(z.id)}">Ajustar</button>
              <button type="button" class="cx-mini" data-pick="${esc(z.id)}">Cambiar</button>
              <button type="button" class="cx-mini" data-remove="${esc(z.id)}">Eliminar</button>
            </div>` : `
            <button type="button" class="cx-drop" data-pick="${esc(z.id)}">
              <i class="ico ico--destellos" aria-hidden="true"></i>
              <span><b>Subir mi diseño</b><small>PNG, JPG o WEBP · máx. ${uploadRules().maxMb} MB · puedes arrastrarlo aquí</small></span>
            </button>`}
        </div>`;
    }).join('');
  }

  /* ----- Camiseta y zonas ----- */
  function renderShirt() {
    const c = color();
    const img = c.images?.[state.face];
    shirt.innerHTML = img
      ? `<img src="${esc(img)}" alt="Camiseta ${esc(c.name.toLowerCase())} vista de ${state.face === 'front' ? 'frente' : 'espalda'}" crossorigin="anonymous">`
      : teeSvg(state.face, c.hex, 'stage');
    stage.classList.toggle('is-light', isLight(c.hex));
    $('[data-face-label]').textContent = `${FACE_NAME[state.face]} · ${c.name}`;
    main.querySelectorAll('[data-face]').forEach((b) => {
      const has = Boolean(zoneOnFace(mode(), b.dataset.face));
      b.setAttribute('aria-pressed', String(b.dataset.face === state.face));
      b.classList.toggle('has-zone', has);
    });
    renderZones();
  }

  function renderZones() {
    const z = zoneOnFace(mode(), state.face);
    if (!z) {
      zonesBox.innerHTML = `<p class="cx-nozone">Esta modalidad no tiene estampado en la ${FACE_NAME[state.face].toLowerCase()}.</p>`;
      renderTools();
      return;
    }
    const r = zoneRect(z);
    const d = state.designs[z.id];
    zonesBox.innerHTML = `
      <div class="cx-zone${d ? ' has-design' : ''}${state.active === z.id ? ' is-active' : ''}" data-zone="${esc(z.id)}"
        style="left:${r.left}%;top:${r.top}%;width:${r.width}%;height:${r.height}%"
        tabindex="0" role="${d ? 'application' : 'button'}"
        aria-label="${esc(`${z.label}, máximo ${cmText(z)}. ${d ? 'Arrastra para mover; usa las flechas para mover y + o − para cambiar el tamaño.' : 'Pulsa para subir una imagen.'}`)}">
        ${d ? `<img class="cx-zone__img" src="${d.url}" alt="${esc(`Tu diseño ${d.name}`)}" draggable="false">` : `
          <span class="cx-zone__empty"><b>${esc(z.label)}</b><span>${esc(cmText(z))}</span><span class="cx-zone__cta">+ Subir diseño</span></span>`}
        <span class="cx-zone__tag">${esc(cmText(z))}</span>
      </div>`;
    if (d) placeImg(z);
    renderTools();
  }

  /** Tamaño "contenido" de la imagen dentro de la zona (fracción del ancho y alto de la zona). */
  function fitOf(z, d) {
    const imgA = d.w / d.h;
    const zoneA = z.widthCm / z.heightCm;
    return imgA > zoneA ? { fw: 1, fh: zoneA / imgA } : { fw: imgA / zoneA, fh: 1 };
  }

  function clampDesign(z, d) {
    d.scale = Math.min(1, Math.max(0.1, d.scale));
    const { fw, fh } = fitOf(z, d);
    const mx = (1 - fw * d.scale) / 2;
    const my = (1 - fh * d.scale) / 2;
    d.ox = Math.min(mx, Math.max(-mx, d.ox));
    d.oy = Math.min(my, Math.max(-my, d.oy));
  }

  /** Tamaño real impreso (cm) de la imagen tal como está colocada. */
  function printedCm(z, d) {
    const { fw, fh } = fitOf(z, d);
    return { w: fw * d.scale * z.widthCm, h: fh * d.scale * z.heightCm };
  }

  function placeImg(z) {
    const d = state.designs[z.id];
    const img = zonesBox.querySelector('.cx-zone__img');
    if (!d || !img) return;
    clampDesign(z, d);
    const { fw, fh } = fitOf(z, d);
    const w = fw * d.scale;
    const h = fh * d.scale;
    img.style.width = `${w * 100}%`;
    img.style.height = `${h * 100}%`;
    img.style.left = `${(0.5 + d.ox - w / 2) * 100}%`;
    img.style.top = `${(0.5 + d.oy - h / 2) * 100}%`;
    const tag = zonesBox.querySelector('.cx-zone__tag');
    const cm = printedCm(z, d);
    tag.textContent = `${fmt(cm.w)} × ${fmt(cm.h)} cm`;
    const check = quality(z, d);
    const slotCheck = main.querySelector(`[data-check="${CSS.escape(z.id)}"]`);
    if (slotCheck) { slotCheck.textContent = check.text; slotCheck.className = `cx-check cx-check--${check.level}`; }
    const range = tools.querySelector('[data-scale]');
    if (range && document.activeElement !== range) range.value = Math.round(d.scale * 100);
    const out = tools.querySelector('[data-scale-out]');
    if (out) out.textContent = `${Math.round(d.scale * 100)} % · ${fmt(cm.w)} × ${fmt(cm.h)} cm`;
  }

  /** Nitidez esperada según los píxeles del archivo y el tamaño impreso. */
  function quality(z, d) {
    const cm = printedCm(z, d);
    const dpi = Math.round(Math.min(d.w / (cm.w / 2.54), d.h / (cm.h / 2.54)));
    const r = uploadRules();
    if (dpi < r.minDpi) return { level: 'bad', dpi, text: `Resolución baja (${dpi} ppp a este tamaño): podría verse pixelado. Sube un archivo más grande o reduce el tamaño.` };
    if (dpi < r.goodDpi) return { level: 'warn', dpi, text: `Resolución justa (${dpi} ppp): podría perder nitidez al imprimirse. Si tienes una versión más grande, sube esa.` };
    return { level: 'ok', dpi, text: `Buena resolución para este tamaño (${dpi} ppp). KOVA revisará el archivo original antes de estampar.` };
  }

  function renderTools() {
    const z = zoneOnFace(mode(), state.face);
    const d = z && state.designs[z.id];
    tools.hidden = !d;
    if (!d) return;
    state.active = z.id;
    tools.innerHTML = `
      <div class="cx-tools__row">
        <label class="cx-tools__scale"><span>Tamaño</span>
          <input type="range" min="10" max="100" step="1" value="${Math.round(d.scale * 100)}" data-scale aria-label="Tamaño del diseño en la zona">
        </label>
        <output class="cx-tools__out" data-scale-out></output>
      </div>
      <div class="cx-tools__row cx-tools__btns">
        <div class="cx-pad" role="group" aria-label="Mover diseño">
          <button type="button" data-nudge="0,-1" aria-label="Mover arriba">↑</button>
          <button type="button" data-nudge="-1,0" aria-label="Mover a la izquierda">←</button>
          <button type="button" data-nudge="1,0" aria-label="Mover a la derecha">→</button>
          <button type="button" data-nudge="0,1" aria-label="Mover abajo">↓</button>
        </div>
        <button type="button" class="btn btn--line btn--sm" data-center>Centrar</button>
        <button type="button" class="btn btn--line btn--sm" data-reset>Restablecer</button>
      </div>`;
    placeImg(z);
  }

  /* ----- Precio, cantidad y estado ----- */
  function maxQty() {
    const stock = state.size ? stockOf(state.color, state.size) : null;
    return stock === null ? MAX_QTY : Math.max(1, Math.min(MAX_QTY, stock));
  }

  function renderBuy() {
    const m = mode();
    state.qty = Math.min(state.qty, maxQty());
    const price = priceOf(m.id);
    $('[data-price]').textContent = formatPrice(price * state.qty);
    $('[data-price-detail]').textContent = `${m.name} · ${m.label} · ${state.qty > 1 ? `${state.qty} × ${formatPrice(price)} · ` : ''}camiseta + estampado incluidos`;
    $('[data-qty-value]').textContent = state.qty;
    main.querySelector('[data-qty="-1"]').disabled = state.qty <= 1;
    main.querySelector('[data-qty="1"]').disabled = state.qty >= maxQty();
    const missing = [];
    if (!state.size) missing.push('talla');
    const st = $('[data-buy-state]');
    if (missing.length) { st.textContent = `Falta elegir: ${missing.join(' y ')}.`; st.className = 'checkout-state status status--off'; }
    else {
      const designs = modeZones(m).filter((z) => state.designs[z.id]).length;
      st.textContent = designs ? 'Listo para agregar al carrito.' : 'Listo. Si aún no tienes el diseño, lo subes después desde la página de tu pedido.';
      st.className = 'checkout-state status status--on';
    }
  }

  function renderAll() {
    renderColors();
    renderSizes();
    renderModes();
    renderSlots();
    renderShirt();
    renderBuy();
  }

  /* ----- Archivos (solo en el navegador) ----- */
  function pick(zoneId) {
    pendingZone = zoneId;
    fileInput.value = '';
    fileInput.click();
  }

  async function loadFile(zoneId, file) {
    const z = modeZones(mode()).find((x) => x.id === zoneId);
    if (!z || !file) return;
    const rules = uploadRules();
    const typeOk = TYPES[file.type] || (!file.type && EXT.test(file.name));
    if (!typeOk || !EXT.test(file.name)) return toast(`«${file.name}» no es un formato admitido. Usa PNG, JPG o WEBP.`);
    if (file.size > rules.maxMb * 1024 * 1024) return toast(`«${file.name}» pesa ${fmtBytes(file.size)}. El máximo es ${rules.maxMb} MB: exporta una versión más liviana (PNG o JPG).`);
    if (file.size < 100) return toast(`«${file.name}» está vacío o dañado.`);
    const url = URL.createObjectURL(file);
    let w; let h;
    try {
      const img = new Image();
      img.decoding = 'async';
      img.src = url;
      await img.decode();
      w = img.naturalWidth; h = img.naturalHeight;
    } catch {
      URL.revokeObjectURL(url);
      return toast(`No pudimos abrir «${file.name}». Puede estar dañado o no ser una imagen compatible.`);
    }
    if (!w || !h) { URL.revokeObjectURL(url); return toast(`«${file.name}» no tiene dimensiones válidas.`); }
    if (Math.min(w, h) < 100) { URL.revokeObjectURL(url); return toast(`«${file.name}» es demasiado pequeña (${w} × ${h} px). Usa una imagen de al menos 100 px por lado.`); }
    const prev = state.designs[zoneId];
    if (prev) URL.revokeObjectURL(prev.url);
    state.designs[zoneId] = { file, name: file.name, size: file.size, type: file.type || 'image/png', url, w, h, scale: 1, ox: 0, oy: 0 };
    state.active = zoneId;
    state.face = z.face;
    renderSlots();
    renderShirt();
    renderBuy();
    // En celular el estudio queda arriba: se lleva la vista a la camiseta para ver el diseño.
    const box = stage.getBoundingClientRect();
    if (box.bottom < 80 || box.top > innerHeight - 80) stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const q = quality(z, state.designs[zoneId]);
    toast(q.level === 'ok' ? 'Diseño listo en la previsualización.' : 'Diseño cargado. Revisa el aviso de resolución.');
    if (file.type === 'image/jpeg') toast('Tip: un PNG con fondo transparente da mejores resultados que un JPG.');
  }

  function removeDesign(zoneId) {
    const d = state.designs[zoneId];
    if (d) URL.revokeObjectURL(d.url);
    delete state.designs[zoneId];
    renderSlots();
    renderShirt();
    renderBuy();
  }

  fileInput.addEventListener('change', () => loadFile(pendingZone, fileInput.files[0]));

  /* ----- Eventos del formulario ----- */
  panel.addEventListener('change', (e) => {
    const { name, value } = e.target;
    if (name === 'color') {
      state.color = value;
      if (state.size && !isComboAvailable(state.color, state.size)) {
        toast(`La talla ${state.size} no está disponible en ${color().name.toLowerCase()}.`);
        state.size = null;
      }
      renderColors(); renderSizes(); renderShirt(); renderBuy();
    }
    if (name === 'size') { state.size = value; $('[data-step="size"]').classList.remove('is-error'); renderSizes(); renderBuy(); }
    if (name === 'mode') {
      state.mode = value;
      const zones = modeZones(mode());
      if (!zoneOnFace(mode(), state.face)) state.face = zones[0].face;
      state.active = zoneOnFace(mode(), state.face)?.id ?? null;
      renderSlots(); renderShirt(); renderBuy();
    }
  });

  panel.addEventListener('click', (e) => {
    const t = e.target.closest('[data-pick],[data-remove],[data-edit],[data-qty]');
    if (!t) return;
    if (t.dataset.pick) pick(t.dataset.pick);
    if (t.dataset.remove) removeDesign(t.dataset.remove);
    if (t.dataset.edit) {
      const z = modeZones(mode()).find((x) => x.id === t.dataset.edit);
      state.face = z.face; state.active = z.id;
      renderShirt();
      stage.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (t.dataset.qty) { state.qty = Math.max(1, Math.min(maxQty(), state.qty + Number(t.dataset.qty))); renderBuy(); }
  });

  // Arrastrar un archivo sobre una ranura o sobre la zona de la camiseta.
  ['dragover', 'drop'].forEach((type) => main.addEventListener(type, (e) => {
    const target = e.target.closest('[data-slot],[data-zone]');
    if (!target || !e.dataTransfer?.types.includes('Files')) return;
    e.preventDefault();
    if (type === 'drop') loadFile(target.dataset.slot ?? target.dataset.zone, e.dataTransfer.files[0]);
  }));

  main.querySelector('[data-facebar]').addEventListener('click', (e) => {
    const b = e.target.closest('[data-face]');
    if (!b) return;
    state.face = b.dataset.face;
    renderShirt();
  });

  /* ----- Mover y escalar: ratón, dedo, pellizco, rueda y teclado ----- */
  const pointers = new Map();
  let gesture = null;

  const activeZone = () => zoneOnFace(mode(), state.face);
  const zoneEl = () => zonesBox.querySelector('.cx-zone');

  zonesBox.addEventListener('click', (e) => {
    const el = e.target.closest('.cx-zone');
    if (el && !el.classList.contains('has-design')) pick(el.dataset.zone);
  });

  zonesBox.addEventListener('pointerdown', (e) => {
    const el = e.target.closest('.cx-zone.has-design');
    if (!el) return;
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    el.focus({ preventScroll: true });
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const z = activeZone();
    const d = state.designs[z.id];
    const rect = el.getBoundingClientRect();
    const pts = [...pointers.values()];
    gesture = {
      rect, ox: d.ox, oy: d.oy, scale: d.scale,
      start: centroid(pts), dist: pts.length > 1 ? distance(pts[0], pts[1]) : 0,
    };
    el.classList.add('is-dragging');
  });

  zonesBox.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId) || !gesture) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const z = activeZone();
    const d = state.designs[z.id];
    const pts = [...pointers.values()];
    const c = centroid(pts);
    d.ox = gesture.ox + (c.x - gesture.start.x) / gesture.rect.width;
    d.oy = gesture.oy + (c.y - gesture.start.y) / gesture.rect.height;
    if (pts.length > 1 && gesture.dist) d.scale = gesture.scale * (distance(pts[0], pts[1]) / gesture.dist);
    placeImg(z);
  });

  const endPointer = (e) => {
    if (!pointers.delete(e.pointerId)) return;
    zoneEl()?.classList.remove('is-dragging');
    // Al soltar un dedo del pellizco se reinicia el gesto con los que quedan.
    if (pointers.size && gesture) {
      const z = activeZone(); const d = state.designs[z.id]; const pts = [...pointers.values()];
      gesture = { ...gesture, ox: d.ox, oy: d.oy, scale: d.scale, start: centroid(pts), dist: pts.length > 1 ? distance(pts[0], pts[1]) : 0 };
    } else gesture = null;
  };
  zonesBox.addEventListener('pointerup', endPointer);
  zonesBox.addEventListener('pointercancel', endPointer);

  zonesBox.addEventListener('wheel', (e) => {
    const el = e.target.closest('.cx-zone.has-design');
    if (!el) return;
    e.preventDefault();
    const z = activeZone();
    state.designs[z.id].scale *= e.deltaY < 0 ? 1.05 : 0.95;
    placeImg(z);
  }, { passive: false });

  zonesBox.addEventListener('keydown', (e) => {
    const el = e.target.closest('.cx-zone');
    if (!el) return;
    if (!el.classList.contains('has-design')) {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(el.dataset.zone); }
      return;
    }
    const z = activeZone(); const d = state.designs[z.id];
    const step = e.shiftKey ? 0.05 : 0.01;
    const moves = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (moves[e.key]) { d.ox += moves[e.key][0]; d.oy += moves[e.key][1]; }
    else if (e.key === '+' || e.key === '=') d.scale *= 1.05;
    else if (e.key === '-' || e.key === '_') d.scale *= 0.95;
    else return;
    e.preventDefault();
    placeImg(z);
  });

  tools.addEventListener('input', (e) => {
    if (!e.target.matches('[data-scale]')) return;
    const z = activeZone();
    state.designs[z.id].scale = Number(e.target.value) / 100;
    placeImg(z);
  });
  tools.addEventListener('click', (e) => {
    const z = activeZone(); const d = z && state.designs[z.id];
    if (!d) return;
    const nudge = e.target.closest('[data-nudge]');
    if (nudge) { const [x, y] = nudge.dataset.nudge.split(',').map(Number); d.ox += x * 0.02; d.oy += y * 0.02; }
    if (e.target.closest('[data-center]')) { d.ox = 0; d.oy = 0; }
    if (e.target.closest('[data-reset]')) { d.ox = 0; d.oy = 0; d.scale = 1; }
    placeImg(z);
  });

  /* ----- Agregar al carrito ----- */
  panel.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!state.size) {
      const step = $('[data-step="size"]');
      step.classList.add('is-error');
      $('[data-size-hint]').textContent = 'Elige una talla para continuar';
      step.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
    const m = mode();
    const files = {}; const place = {}; const originals = {};
    modeZones(m).forEach((z) => {
      const d = state.designs[z.id];
      if (!d) return;
      files[z.face] = d.name;
      originals[z.face] = d.file;
      place[z.face] = printedCm(z, d);
    });
    const btn = $('[data-add]');
    btn.setAttribute('aria-busy', 'true');
    const thumb = await makeThumb().catch(() => '');
    btn.removeAttribute('aria-busy');
    const res = addCustomItem({ mode: m.id, color: state.color, size: state.size, qty: state.qty, files, place, thumb });
    if (!res.ok) { toast(res.error ?? 'No se pudo agregar. Revisa tu selección.'); renderAll(); return; }
    const kept = Object.keys(originals).length ? await saveDesigns(res.ref, originals) : true;
    const added = $('[data-added]');
    added.hidden = false;
    added.innerHTML = `
      <p><b>${res.qty} × KOVA CUSTOM ${esc(m.name)}</b> (${esc(color().name)}, talla ${esc(state.size)}) quedó en tu carrito${res.capped ? ` · máximo ${res.max} por pedido` : ''}.</p>
      <p>${Object.keys(originals).length && kept
        ? `${Object.keys(originals).length > 1 ? 'Tus diseños se suben' : 'Tu diseño se sube'} de forma privada al registrar el pedido.${Object.keys(originals).length < modeZones(m).length ? ' El que falta lo subes desde la página de tu pedido.' : ''}`
        : `Al registrar el pedido, sube ${modeZones(m).length > 1 ? 'los archivos del frente y de la espalda' : 'tu archivo original'} desde la página de tu pedido.`}</p>
      <div class="cx-added__actions">
        <button class="btn btn--light btn--sm" type="button" data-open-cart>Ver carrito y finalizar</button>
        <a class="btn btn--line btn--sm" href="index.html#catalogo">Seguir comprando</a>
      </div>`;
    added.querySelector('[data-open-cart]').addEventListener('click', () => document.querySelector('.cart-fab')?.click());
    toast('KOVA CUSTOM agregado al carrito.');
  });

  /** Miniatura pequeña (vista principal) para el carrito. Solo se guarda en este navegador. */
  async function makeThumb() {
    const m = mode();
    const face = (modeZones(m).find((z) => state.designs[z.id]) ?? modeZones(m)[0]).face;
    const W = 240; const H = 280;
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#f0e7de';
    ctx.fillRect(0, 0, W, H);
    const c = color();
    const src = c.images?.[face] || `data:image/svg+xml;charset=utf-8,${encodeURIComponent(teeSvg(face, c.hex, 'thumb'))}`;
    ctx.drawImage(await loadImg(src), 0, 0, W, H);
    const z = zoneOnFace(m, face);
    const d = z && state.designs[z.id];
    if (d) {
      clampDesign(z, d);
      const r = zoneRect(z);
      const { fw, fh } = fitOf(z, d);
      const zw = (r.width / 100) * W; const zh = (r.height / 100) * H;
      const w = fw * d.scale * zw; const h = fh * d.scale * zh;
      const x = (r.left / 100) * W + (0.5 + d.ox) * zw - w / 2;
      const y = (r.top / 100) * H + (0.5 + d.oy) * zh - h / 2;
      ctx.drawImage(await loadImg(d.url), x, y, w, h);
    }
    let out = canvas.toDataURL('image/webp', 0.8);
    if (!out.startsWith('data:image/webp')) out = canvas.toDataURL('image/jpeg', 0.82);
    return out;
  }

  renderAll();
  pruneOldDesigns();
}

/* ---------- Utilidades ---------- */
function loadImg(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    if (/^https?:/.test(src)) img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
const centroid = (pts) => ({ x: pts.reduce((n, p) => n + p.x, 0) / pts.length, y: pts.reduce((n, p) => n + p.y, 0) / pts.length });
const distance = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const fmt = (n) => String(Math.round(n * 10) / 10).replace('.', ',');
const fmtBytes = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
