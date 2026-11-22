/**
 * Panel: KOVA CUSTOM (#/custom) y Pagos y WhatsApp (#/ajustes).
 *
 * Todo se guarda en Supabase (tabla store_settings) y la tienda lo lee de ahí en cada visita,
 * así que los cambios los ven todos los clientes (ver js/services/settings.js).
 * Los diseños de los clientes no pasan por aquí: llegan por WhatsApp.
 *
 * Edición: cada campo lleva data-k="ruta.del.valor" (p. ej. "modes.2.price") y se escribe
 * directamente en el borrador. Agregar o quitar filas vuelve a pintar la tarjeta.
 */
import { CONFIG } from '../../js/config.js';
import { customDefaults } from '../../js/data/custom.js';
import { normalizeCustom, normalizeContact, normalizePayments } from '../../js/services/settings.js';
import { cmText } from '../../js/services/custom.js';
import { teeSvg } from '../../js/components/teeMockup.js';
import { formatPrice } from '../../js/utils/format.js';
import { esc, toast } from '../../js/utils/dom.js';
import * as api from './api.js';
import { prepareImage, ACCEPT } from './images.js';

const imgSrc = (url) => (!url ? '' : /^(https?:|blob:|data:|\/)/.test(url) ? url : `../${url}`);
const slug = (t) => String(t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

let draft = null;       // { kind: 'custom' | 'store', data, snapshot }

export const isSettingsDirty = () => Boolean(draft && JSON.stringify(draft.data) !== draft.snapshot);
export const clearSettingsDraft = () => { draft = null; };

/* ---------- Ruta "a.b.0.c" ---------- */
function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  keys.slice(0, -1).forEach((k, i) => {
    if (o[k] === undefined || o[k] === null) o[k] = keys[0] !== 'inventory' && /^\d+$/.test(keys[i + 1]) ? [] : {};
    o = o[k];
  });
  o[keys.at(-1)] = value;
}

function readInput(el) {
  if (el.type === 'checkbox') return el.checked;
  if (el.dataset.type === 'money') return Number(el.value.replace(/\D/g, '')) || 0;
  if (el.dataset.type === 'num') return el.value === '' ? '' : Number(el.value.replace(',', '.'));
  if (el.dataset.type === 'stock') return el.value === '' ? null : Math.max(0, Math.floor(Number(el.value)));
  return el.value;
}

/* ---------- Carga común ---------- */
async function loadSettings(view, title) {
  view.innerHTML = `<div class="adm-boot adm-boot--light"><i class="ico ico--destellos twinkle" aria-hidden="true"></i><span>Cargando ${esc(title)}…</span></div>`;
  try {
    return { map: await api.getSettings() };
  } catch (err) {
    view.innerHTML = `<div class="adm-wrap"><div class="adm-alert">
      ${api.isMissingTable(err)
        ? `<b>Falta crear la tabla de ajustes en Supabase.</b>
           <p>Abre Supabase → SQL Editor, pega el archivo <code>supabase/schema.sql</code> del repositorio y pulsa Run (se puede ejecutar de nuevo sin perder datos). Luego recarga esta página.</p>
           <p>Mientras tanto la tienda funciona con los valores iniciales (precios oficiales, Llave Nu y el WhatsApp actual).</p>`
        : `<b>No se pudieron cargar los ajustes.</b><p>${esc(api.friendlyError(err))}</p>`}
      <button class="btn btn--primary btn--sm" type="button" onclick="location.reload()">Reintentar</button></div></div>`;
    return null;
  }
}

function saveBar(label) {
  return `
    <div class="adm-savebar s-navy">
      <span class="adm-savebar__state" data-dirty></span>
      <div class="adm-savebar__actions">
        <button class="btn btn--line btn--sm" type="button" data-discard>Descartar cambios</button>
        <button class="btn btn--primary btn--sm" type="submit" data-save>${esc(label)}</button>
      </div>
    </div>`;
}

function updateDirty(form) {
  const el = form.querySelector('[data-dirty]');
  const dirty = isSettingsDirty();
  el.textContent = dirty ? '● Cambios sin guardar' : 'Todo guardado. Los clientes ven esta configuración.';
  el.classList.toggle('is-dirty', dirty);
}

async function pickImage(folder) {
  const input = document.createElement('input');
  input.type = 'file';
  input.accept = ACCEPT;
  const file = await new Promise((resolve) => {
    input.addEventListener('change', () => resolve(input.files[0] ?? null), { once: true });
    input.click();
  });
  if (!file) return null;
  const blob = await prepareImage(file);
  return api.uploadImage(folder, blob);
}

/* =========================================================================
 * KOVA CUSTOM
 * ========================================================================= */
export async function renderCustomSettings(view, { confirmDialog }) {
  const loaded = await loadSettings(view, 'KOVA Custom');
  if (!loaded) return;
  const data = normalizeCustom(loaded.map.custom);
  draft = { kind: 'custom', data, snapshot: JSON.stringify(data), saved: Boolean(loaded.map.custom) };

  view.innerHTML = `
    <form class="adm-wrap adm-editor adm-set" data-settings novalidate>
      <div class="adm-head">
        <div>
          <p class="eyebrow">Personalización</p>
          <h1 class="adm-head__title">KOVA Custom<span class="dot">.</span></h1>
        </div>
        <a class="adm-link" href="../custom.html" target="_blank" rel="noopener">Ver KOVA Custom en la tienda ↗</a>
      </div>
      ${draft.saved ? '' : '<div class="adm-alert adm-alert--info"><b>Usando los valores iniciales.</b><p>Estos son los precios y medidas oficiales. Al guardar por primera vez quedan en la base de datos y desde entonces los cambios se aplican a todos los clientes.</p></div>'}
      <p class="adm-note">Los diseños de los clientes no se suben a la web: llegan al WhatsApp de KOVA junto con el resumen del pedido. Los cambios de precio no afectan pedidos ya enviados.</p>

      <section class="adm-card"><h2 class="adm-card__title"><span>01</span> Modalidades y precios <small>Precio final en COP (camiseta + estampados). Desactiva una modalidad para ocultarla sin borrarla.</small></h2><div data-sec="modes"></div></section>
      <section class="adm-card"><h2 class="adm-card__title"><span>02</span> Zonas y medidas de estampación <small>Medidas máximas en cm y posición sobre la camiseta (x = centro horizontal, y = borde superior, en % del lienzo).</small></h2><div data-sec="zones"></div></section>
      <section class="adm-card"><h2 class="adm-card__title"><span>03</span> Colores e imágenes de las camisetas <small>Sin imagen se dibuja la camiseta con el color elegido. Si subes fotos, usa proporción 6:7 con la camiseta centrada de frente y de espalda.</small></h2><div data-sec="colors"></div></section>
      <section class="adm-card"><h2 class="adm-card__title"><span>04</span> Tallas <small>Pulsa para activar o desactivar. Puedes agregar tallas nuevas.</small></h2><div data-sec="sizes"></div></section>
      <section class="adm-card"><h2 class="adm-card__title"><span>05</span> Inventario y disponibilidad <small>Unidades por color y talla. Vacío = disponible sin límite · 0 = agotado (no se puede comprar). Descuéntalo a mano cuando confirmes un pedido.</small></h2><div data-sec="inventory"></div></section>
      <section class="adm-card"><h2 class="adm-card__title"><span>06</span> Escala de la previsualización y archivos <small>Ajustes técnicos: cuántos cm reales mide el ancho completo del lienzo, y límites para la imagen de previsualización.</small></h2><div data-sec="tech"></div></section>
      ${saveBar('Guardar KOVA Custom')}
    </form>`;

  const form = view.querySelector('[data-settings]');
  const d = () => draft.data;
  const render = (sec) => {
    const box = form.querySelector(`[data-sec="${sec}"]`);
    box.innerHTML = SECTIONS[sec](d());
    if (sec === 'zones') drawZonePreview(form);
  };
  const renderAll = () => Object.keys(SECTIONS).forEach(render);

  form.addEventListener('input', (e) => {
    const el = e.target;
    if (!el.dataset.k) return;
    setPath(d(), el.dataset.k, readInput(el));
    if (el.dataset.type === 'money') {
      const hint = el.closest('.adm-money')?.querySelector('[data-money]');
      if (hint) hint.textContent = formatPrice(readInput(el));
    }
    if (el.dataset.k.startsWith('zones') || el.dataset.k.startsWith('mockup')) drawZonePreview(form);
    if (/^colors\.\d+\.(name|hex|active)$/.test(el.dataset.k)) render('inventory');
    if (/^modes\.\d+\.zones/.test(el.dataset.k)) render('zones');
    updateDirty(form);
  });

  form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const { act, i } = b.dataset;
    const n = Number(i);
    const data = d();
    if (act === 'mode-add') data.modes.push({ id: `custom-${Date.now().toString(36)}`, name: 'CUSTOM NUEVO', label: '', zones: [data.zones[0].id], price: 0, active: false });
    if (act === 'mode-del') {
      if (!(await confirmDialog({ title: 'Eliminar modalidad', body: `<p>¿Eliminar <b>${esc(data.modes[n].name)}</b>? Si solo quieres ocultarla, desactívala.</p>`, confirm: 'Eliminar', danger: true }))) return;
      data.modes.splice(n, 1);
    }
    if (act === 'mode-zone') {
      const m = data.modes[n];
      const z = b.dataset.zone;
      m.zones = m.zones.includes(z) ? m.zones.filter((x) => x !== z) : [...m.zones, z];
      if (!m.zones.length) { m.zones = [z]; toast('Cada modalidad necesita al menos una zona.'); }
    }
    if (act === 'zone-add') data.zones.push({ id: `zona-${Date.now().toString(36)}`, label: 'Zona nueva', face: 'front', widthCm: 10, heightCm: 10, x: 50, y: 25 });
    if (act === 'zone-del') {
      const z = data.zones[n];
      const used = data.modes.filter((m) => m.zones.includes(z.id));
      if (used.length) return toast(`No se puede borrar: la usa ${used.map((m) => m.name).join(', ')}.`);
      data.zones.splice(n, 1);
    }
    if (act === 'color-add') data.colors.push({ id: `color-${Date.now().toString(36)}`, name: 'Color nuevo', hex: '#777777', active: false, images: { front: '', back: '' } });
    if (act === 'color-del') {
      if (!(await confirmDialog({ title: 'Eliminar color', body: `<p>¿Eliminar <b>${esc(data.colors[n].name)}</b> y su inventario? Para ocultarlo sin borrarlo, desactívalo.</p>`, confirm: 'Eliminar', danger: true }))) return;
      delete data.inventory[data.colors[n].id];
      data.colors.splice(n, 1);
    }
    if (act === 'color-img') {
      const face = b.dataset.face;
      const restore = busy(b, 'Subiendo…');
      try {
        const url = await pickImage(`custom-${data.colors[n].id}`);
        if (url) data.colors[n].images[face] = url;
      } catch (err) { toast(api.friendlyError(err)); }
      restore();
    }
    if (act === 'color-img-clear') data.colors[n].images[b.dataset.face] = '';
    if (act === 'size-toggle') data.sizes[n].active = !data.sizes[n].active;
    if (act === 'size-del') data.sizes.splice(n, 1);
    if (act === 'size-move') { const t = n + Number(b.dataset.dir); if (t >= 0 && t < data.sizes.length) [data.sizes[n], data.sizes[t]] = [data.sizes[t], data.sizes[n]]; }
    if (act === 'size-add') {
      const input = form.querySelector('[name="new-size"]');
      const v = input.value.trim().toUpperCase().slice(0, 12);
      if (!v) return input.focus();
      if (data.sizes.some((s) => s.id === v)) return toast('Esa talla ya existe.');
      data.sizes.push({ id: v, active: true });
    }
    if (act === 'inv-fill') {
      const v = b.dataset.value === '' ? null : Number(b.dataset.value);
      data.colors.forEach((c) => data.sizes.forEach((s) => {
        if (v === null) { if (data.inventory[c.id]) delete data.inventory[c.id][s.id]; } else (data.inventory[c.id] ??= {})[s.id] = v;
      }));
    }
    if (act === 'reset-defaults') {
      if (!(await confirmDialog({ title: 'Restaurar valores oficiales', body: '<p>Se cargarán los precios, modalidades y medidas oficiales. No se guarda hasta que pulses «Guardar».</p>', confirm: 'Restaurar' }))) return;
      const base = normalizeCustom(customDefaults);
      data.modes = base.modes; data.zones = base.zones; data.mockup = base.mockup;
    }
    renderAll();
    updateDirty(form);
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = d();
    // Identificadores estables a partir del nombre para colores nuevos.
    data.colors.forEach((c) => { if (/^color-[a-z0-9]+$/.test(c.id) && slug(c.name) && !data.colors.some((x) => x !== c && x.id === slug(c.name))) { const old = c.id; c.id = slug(c.name); if (data.inventory[old]) { data.inventory[c.id] = data.inventory[old]; delete data.inventory[old]; } } });
    const problems = [];
    if (!data.modes.some((m) => m.active)) problems.push('Activa al menos una modalidad.');
    if (data.modes.some((m) => !m.name.trim())) problems.push('Todas las modalidades necesitan nombre.');
    if (data.modes.some((m) => !(m.price > 0))) problems.push('Revisa los precios: deben ser mayores que cero.');
    if (data.zones.some((z) => !(z.widthCm > 0 && z.heightCm > 0))) problems.push('Revisa las medidas de las zonas.');
    if (!data.colors.some((c) => c.active)) problems.push('Activa al menos un color.');
    if (!data.sizes.some((s) => s.active)) problems.push('Activa al menos una talla.');
    if (problems.length) {
      toast(problems[0]);
      return;
    }
    const value = normalizeCustom(data);
    const restore = busy(form.querySelector('[data-save]'), 'Guardando…');
    try {
      await api.saveSetting('custom', value);
      draft.data = value;
      draft.snapshot = JSON.stringify(value);
      draft.saved = true;
      renderAll();
      toast('KOVA Custom guardado. Los clientes ya ven los cambios.');
    } catch (err) { toast(api.friendlyError(err)); }
    restore();
    updateDirty(form);
  });

  form.querySelector('[data-discard]').addEventListener('click', () => {
    draft.data = JSON.parse(draft.snapshot);
    renderAll();
    updateDirty(form);
  });

  renderAll();
  updateDirty(form);
}

const SECTIONS = {
  modes: (d) => `
    <div class="adm-table-wrap"><table class="adm-table">
      <thead><tr><th>Activa</th><th>Nombre</th><th>Ubicación (texto)</th><th>Zonas</th><th>Precio (COP)</th><th><span class="sr-only">Acciones</span></th></tr></thead>
      <tbody>
        ${d.modes.map((m, i) => `
          <tr>
            <td><label class="adm-switch adm-switch--bare"><input type="checkbox" data-k="modes.${i}.active"${m.active ? ' checked' : ''}><span class="adm-switch__ui"></span><span class="sr-only">Activa</span></label></td>
            <td><input class="field__input" data-k="modes.${i}.name" value="${esc(m.name)}" maxlength="40" aria-label="Nombre"></td>
            <td><input class="field__input" data-k="modes.${i}.label" value="${esc(m.label)}" maxlength="60" aria-label="Ubicación"></td>
            <td><div class="adm-chips adm-chips--sm">${d.zones.map((z) => `<button type="button" class="adm-chip adm-chip--size adm-chip--zone" data-act="mode-zone" data-i="${i}" data-zone="${esc(z.id)}" aria-pressed="${m.zones.includes(z.id)}">${esc(z.label)}</button>`).join('')}</div></td>
            <td class="adm-money"><span class="adm-prefix"><span>$</span><input class="field__input" data-k="modes.${i}.price" data-type="money" inputmode="numeric" value="${esc(m.price.toLocaleString('es-CO'))}" aria-label="Precio"></span><small data-money>${formatPrice(m.price)}</small></td>
            <td><button type="button" class="adm-iconbtn adm-iconbtn--danger" data-act="mode-del" data-i="${i}" aria-label="Eliminar modalidad">✕</button></td>
          </tr>`).join('')}
      </tbody>
    </table></div>
    <div class="adm-chips adm-chips--sm">
      <button type="button" class="adm-chip adm-chip--add" data-act="mode-add">+ Agregar modalidad</button>
      <button type="button" class="adm-chip" data-act="reset-defaults">Restaurar precios y medidas oficiales</button>
    </div>`,

  zones: (d) => `
    <div class="adm-zones">
      <div class="adm-table-wrap"><table class="adm-table">
        <thead><tr><th>Nombre</th><th>Cara</th><th>Ancho (cm)</th><th>Alto (cm)</th><th>x (%)</th><th>y (%)</th><th><span class="sr-only">Acciones</span></th></tr></thead>
        <tbody>
          ${d.zones.map((z, i) => `
            <tr>
              <td><input class="field__input" data-k="zones.${i}.label" value="${esc(z.label)}" maxlength="40" aria-label="Nombre de la zona"></td>
              <td><select class="field__input" data-k="zones.${i}.face" aria-label="Cara"><option value="front"${z.face === 'front' ? ' selected' : ''}>Frente</option><option value="back"${z.face === 'back' ? ' selected' : ''}>Espalda</option></select></td>
              <td><input class="field__input adm-num" data-k="zones.${i}.widthCm" data-type="num" inputmode="decimal" value="${z.widthCm}" aria-label="Ancho en cm"></td>
              <td><input class="field__input adm-num" data-k="zones.${i}.heightCm" data-type="num" inputmode="decimal" value="${z.heightCm}" aria-label="Alto en cm"></td>
              <td><input class="field__input adm-num" data-k="zones.${i}.x" data-type="num" inputmode="decimal" value="${z.x}" aria-label="Posición x"></td>
              <td><input class="field__input adm-num" data-k="zones.${i}.y" data-type="num" inputmode="decimal" value="${z.y}" aria-label="Posición y"></td>
              <td><button type="button" class="adm-iconbtn adm-iconbtn--danger" data-act="zone-del" data-i="${i}" aria-label="Eliminar zona">✕</button></td>
            </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="adm-zonepreview" data-zone-preview></div>
    </div>
    <div class="adm-chips adm-chips--sm"><button type="button" class="adm-chip adm-chip--add" data-act="zone-add">+ Agregar zona</button></div>`,

  colors: (d) => `
    <ul class="adm-colors">
      ${d.colors.map((c, i) => `
        <li class="adm-colorrow">
          <label class="adm-switch adm-switch--bare"><input type="checkbox" data-k="colors.${i}.active"${c.active ? ' checked' : ''}><span class="adm-switch__ui"></span><span class="sr-only">Disponible</span></label>
          <input type="color" class="adm-color" data-k="colors.${i}.hex" value="${esc(c.hex)}" aria-label="Color">
          <input class="field__input" data-k="colors.${i}.name" value="${esc(c.name)}" maxlength="30" aria-label="Nombre del color">
          ${['front', 'back'].map((face) => `
            <div class="adm-colorimg">
              <span class="adm-colorimg__media">${c.images[face] ? `<img src="${esc(imgSrc(c.images[face]))}" alt="">` : teeSvg(face, c.hex, `adm-${i}`)}</span>
              <span class="adm-colorimg__label">${face === 'front' ? 'Frente' : 'Espalda'}${c.images[face] ? '' : ' · dibujo'}</span>
              <span class="adm-colorimg__btns">
                <button type="button" class="adm-iconbtn" data-act="color-img" data-i="${i}" data-face="${face}" title="Subir foto" aria-label="Subir foto ${face === 'front' ? 'de frente' : 'de espalda'}">⇪</button>
                ${c.images[face] ? `<button type="button" class="adm-iconbtn adm-iconbtn--danger" data-act="color-img-clear" data-i="${i}" data-face="${face}" title="Quitar foto" aria-label="Quitar foto">✕</button>` : ''}
              </span>
            </div>`).join('')}
          <button type="button" class="adm-iconbtn adm-iconbtn--danger" data-act="color-del" data-i="${i}" aria-label="Eliminar color">✕</button>
        </li>`).join('')}
    </ul>
    <div class="adm-chips adm-chips--sm"><button type="button" class="adm-chip adm-chip--add" data-act="color-add">+ Agregar color</button></div>`,

  sizes: (d) => `
    <div class="adm-chips">
      ${d.sizes.map((s, i) => `
        <span class="adm-sizechip">
          <button type="button" class="adm-chip adm-chip--size" data-act="size-toggle" data-i="${i}" aria-pressed="${s.active}" title="${s.active ? 'Activa' : 'Inactiva'}">${esc(s.id)}</button>
          <button type="button" class="adm-sizechip__x" data-act="size-move" data-i="${i}" data-dir="-1" aria-label="Mover ${esc(s.id)} antes"${i === 0 ? ' disabled' : ''}>‹</button>
          <button type="button" class="adm-sizechip__x" data-act="size-del" data-i="${i}" aria-label="Eliminar talla ${esc(s.id)}">✕</button>
        </span>`).join('')}
    </div>
    <div class="adm-inline">
      <input class="field__input" name="new-size" maxlength="12" placeholder="Otra talla (ej. 3XL)" aria-label="Nueva talla">
      <button type="button" class="btn btn--line btn--sm" data-act="size-add">Agregar</button>
    </div>`,

  inventory: (d) => {
    const sizes = d.sizes.filter((s) => s.active);
    const colors = d.colors;
    return `
      <div class="adm-table-wrap"><table class="adm-table adm-inv">
        <thead><tr><th>Color</th>${sizes.map((s) => `<th>${esc(s.id)}</th>`).join('')}</tr></thead>
        <tbody>
          ${colors.map((c) => `
            <tr class="${c.active ? '' : 'is-off'}">
              <th scope="row"><span class="adm-dotc" style="background:${esc(c.hex)}"></span>${esc(c.name)}${c.active ? '' : ' <small>(inactivo)</small>'}</th>
              ${sizes.map((s) => {
                const v = d.inventory?.[c.id]?.[s.id];
                return `<td><input class="field__input adm-num${v === 0 ? ' is-zero' : ''}" data-k="inventory.${c.id}.${s.id}" data-type="stock" inputmode="numeric" value="${Number.isInteger(v) ? v : ''}" placeholder="∞" aria-label="${esc(`${c.name} talla ${s.id}`)}"></td>`;
              }).join('')}
            </tr>`).join('')}
        </tbody>
      </table></div>
      <div class="adm-chips adm-chips--sm">
        <button type="button" class="adm-chip" data-act="inv-fill" data-value="">Todo sin límite</button>
        <button type="button" class="adm-chip" data-act="inv-fill" data-value="0">Todo agotado</button>
      </div>`;
  },

  tech: (d) => `
    <div class="adm-two">
      <label class="field"><span class="field__label">Ancho del lienzo — frente (cm reales)</span>
        <input class="field__input" data-k="mockup.cmPerWidth.front" data-type="num" inputmode="decimal" value="${d.mockup.cmPerWidth.front}">
        <span class="field__hint">Con el dibujo incluido, 98 cm ≈ camiseta de 56 cm de pecho. Si subes fotos, mide el pecho en la foto y ajusta.</span></label>
      <label class="field"><span class="field__label">Ancho del lienzo — espalda (cm reales)</span>
        <input class="field__input" data-k="mockup.cmPerWidth.back" data-type="num" inputmode="decimal" value="${d.mockup.cmPerWidth.back}"></label>
    </div>
    <div class="adm-two">
      <label class="field"><span class="field__label">Peso máximo de la imagen de previsualización (MB)</span>
        <input class="field__input" data-k="upload.maxMb" data-type="num" inputmode="decimal" value="${d.upload.maxMb}">
        <span class="field__hint">Solo para la vista previa en el navegador. El archivo original llega por WhatsApp.</span></label>
      <label class="field"><span class="field__label">Resolución: alerta fuerte bajo / alerta suave bajo (ppp)</span>
        <span class="adm-inline"><input class="field__input" data-k="upload.minDpi" data-type="num" inputmode="numeric" value="${d.upload.minDpi}" aria-label="Alerta fuerte"><input class="field__input" data-k="upload.goodDpi" data-type="num" inputmode="numeric" value="${d.upload.goodDpi}" aria-label="Alerta suave"></span></label>
    </div>`,
};

/** Dibuja frente y espalda con las zonas actuales, para ubicar x/y sin adivinar. */
function drawZonePreview(form) {
  const box = form.querySelector('[data-zone-preview]');
  if (!box) return;
  const d = normalizeCustom(draft.data);
  box.innerHTML = ['front', 'back'].map((face) => {
    const rects = d.zones.filter((z) => z.face === face).map((z) => {
      const cm = d.mockup.cmPerWidth[face];
      const w = (z.widthCm / cm) * 100;
      const h = (z.heightCm / cm) * 100 * (6 / 7);
      return `<div class="adm-zp__zone" style="left:${z.x - w / 2}%;top:${z.y}%;width:${w}%;height:${h}%"><span>${esc(z.label)}<br>${esc(cmText(z))}</span></div>`;
    }).join('');
    return `<figure class="adm-zp"><div class="adm-zp__stage">${teeSvg(face, '#1a1a1a', `zp-${face}`)}${rects}</div><figcaption>${face === 'front' ? 'Frente' : 'Espalda'}</figcaption></figure>`;
  }).join('');
}

/* =========================================================================
 * Pagos y WhatsApp
 * ========================================================================= */
export async function renderStoreSettings(view) {
  const loaded = await loadSettings(view, 'ajustes');
  if (!loaded) return;
  const contact = normalizeContact(loaded.map.contact) ?? { number: CONFIG.whatsapp.number, display: CONFIG.whatsapp.display };
  const payments = normalizePayments(loaded.map.payments) ?? normalizePayments(CONFIG.payments);
  const data = {
    contact: { whatsapp: { ...contact } },
    payments: payments.map((p) => ({ id: p.id, label: p.label ?? '', detail: p.detail ?? '', key: p.key ?? '', holder: p.holder ?? '', hint: p.hint ?? '', qr: p.qr ?? '', active: p.active !== false })),
  };
  draft = { kind: 'store', data, snapshot: JSON.stringify(data) };
  const saved = Boolean(loaded.map.contact || loaded.map.payments);

  view.innerHTML = `
    <form class="adm-wrap adm-editor adm-set" data-settings novalidate>
      <div class="adm-head">
        <div>
          <p class="eyebrow">Checkout</p>
          <h1 class="adm-head__title">Pagos y WhatsApp<span class="dot">.</span></h1>
        </div>
      </div>
      ${saved ? '' : '<div class="adm-alert adm-alert--info"><b>Usando los valores del sitio.</b><p>Al guardar, estos datos quedan en la base de datos y el checkout los toma de aquí para todos los clientes.</p></div>'}
      <section class="adm-card"><h2 class="adm-card__title"><span>01</span> WhatsApp Business <small>A este número llegan todos los pedidos (catálogo y KOVA Custom) y los diseños de los clientes.</small></h2><div data-sec="wa"></div></section>
      <section class="adm-card"><h2 class="adm-card__title"><span>02</span> Métodos de pago <small>Información bancaria que ve el cliente al finalizar. La confirmación del pago es manual por WhatsApp.</small></h2><div data-sec="pay"></div></section>
      ${saveBar('Guardar pagos y WhatsApp')}
    </form>`;

  const form = view.querySelector('[data-settings]');
  const render = () => {
    const d = draft.data;
    form.querySelector('[data-sec="wa"]').innerHTML = `
      <div class="adm-two">
        <label class="field"><span class="field__label">Número (con indicativo, solo dígitos) <span>*</span></span>
          <span class="adm-prefix"><span>wa.me/</span><input class="field__input" data-k="contact.whatsapp.number" inputmode="numeric" value="${esc(d.contact.whatsapp.number)}" placeholder="573001234567"></span>
          <span class="field__hint">Colombia: 57 + número de 10 dígitos. Ej.: 573116983724.</span></label>
        <label class="field"><span class="field__label">Cómo se muestra</span>
          <input class="field__input" data-k="contact.whatsapp.display" value="${esc(d.contact.whatsapp.display)}" placeholder="+57 311 698 3724"></label>
      </div>
      <a class="adm-link" href="https://wa.me/${esc(d.contact.whatsapp.number)}" target="_blank" rel="noopener">Probar el enlace ↗</a>`;
    form.querySelector('[data-sec="pay"]').innerHTML = `
      <ul class="adm-pays">
        ${d.payments.map((p, i) => `
          <li class="adm-pay">
            <div class="adm-pay__head">
              <label class="adm-switch adm-switch--bare"><input type="checkbox" data-k="payments.${i}.active"${p.active ? ' checked' : ''}><span class="adm-switch__ui"></span><span><b>${p.active ? 'Visible en el checkout' : 'Oculto'}</b></span></label>
              <span class="adm-pay__btns">
                <button type="button" class="adm-iconbtn" data-act="pay-move" data-i="${i}" data-dir="-1" aria-label="Subir"${i === 0 ? ' disabled' : ''}>↑</button>
                <button type="button" class="adm-iconbtn adm-iconbtn--danger" data-act="pay-del" data-i="${i}" aria-label="Eliminar método">✕</button>
              </span>
            </div>
            <div class="adm-two">
              <label class="field"><span class="field__label">Entidad <span>*</span></span><input class="field__input" data-k="payments.${i}.label" value="${esc(p.label)}" placeholder="Ej. Nu, Nequi, Bancolombia"></label>
              <label class="field"><span class="field__label">Método</span><input class="field__input" data-k="payments.${i}.detail" value="${esc(p.detail)}" placeholder="Ej. Llave, Ahorros, Código QR"></label>
              <label class="field"><span class="field__label">Llave o número de cuenta</span><input class="field__input" data-k="payments.${i}.key" value="${esc(p.key)}" placeholder="Ej. llave o número de cuenta"><span class="field__hint">El cliente la ve con un botón para copiarla.</span></label>
              <label class="field"><span class="field__label">Titular (opcional)</span><input class="field__input" data-k="payments.${i}.holder" value="${esc(p.holder)}"></label>
            </div>
            <label class="field"><span class="field__label">Instrucción corta</span><input class="field__input" data-k="payments.${i}.hint" value="${esc(p.hint)}" maxlength="160"></label>
            <div class="adm-pay__qr">
              ${p.qr ? `<img src="${esc(imgSrc(p.qr))}" alt="QR" width="90" height="90">` : ''}
              <button type="button" class="btn btn--line btn--sm" data-act="pay-qr" data-i="${i}">${p.qr ? 'Cambiar QR' : 'Subir código QR (opcional)'}</button>
              ${p.qr ? `<button type="button" class="adm-link" data-act="pay-qr-clear" data-i="${i}">Quitar QR</button>` : ''}
            </div>
          </li>`).join('')}
      </ul>
      <div class="adm-chips adm-chips--sm"><button type="button" class="adm-chip adm-chip--add" data-act="pay-add">+ Agregar método de pago</button></div>`;
  };

  form.addEventListener('input', (e) => {
    if (!e.target.dataset.k) return;
    setPath(draft.data, e.target.dataset.k, readInput(e.target));
    updateDirty(form);
  });
  form.addEventListener('click', async (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    const n = Number(b.dataset.i);
    const list = draft.data.payments;
    if (b.dataset.act === 'pay-add') list.push({ id: `pago-${Date.now().toString(36)}`, label: '', detail: '', key: '', holder: '', hint: '', qr: '', active: true });
    if (b.dataset.act === 'pay-del') list.splice(n, 1);
    if (b.dataset.act === 'pay-move' && n > 0) [list[n - 1], list[n]] = [list[n], list[n - 1]];
    if (b.dataset.act === 'pay-qr') {
      const restore = busy(b, 'Subiendo…');
      try { const url = await pickImage('pagos'); if (url) list[n].qr = url; } catch (err) { toast(api.friendlyError(err)); }
      restore();
    }
    if (b.dataset.act === 'pay-qr-clear') list[n].qr = '';
    render();
    updateDirty(form);
  });
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const d = draft.data;
    const contact = normalizeContact(d.contact);
    if (!contact) return toast('Escribe un número de WhatsApp válido: indicativo + número, solo dígitos.');
    const payments = normalizePayments(d.payments.map((p) => ({ ...p, id: /^pago-/.test(p.id) && slug(p.label) ? slug(`${p.label}-${p.detail}`) : p.id })));
    if (!payments.some((p) => p.active !== false)) return toast('Deja al menos un método de pago visible, con entidad y llave o QR.');
    const restore = busy(form.querySelector('[data-save]'), 'Guardando…');
    try {
      await api.saveSetting('contact', { whatsapp: contact });
      await api.saveSetting('payments', payments);
      draft.data.contact.whatsapp = contact;
      draft.snapshot = JSON.stringify(draft.data);
      toast('Guardado. El checkout ya usa estos datos.');
    } catch (err) { toast(api.friendlyError(err)); }
    restore();
    updateDirty(form);
  });
  form.querySelector('[data-discard]').addEventListener('click', () => {
    draft.data = JSON.parse(draft.snapshot);
    render();
    updateDirty(form);
  });
  render();
  updateDirty(form);
}

function busy(button, text) {
  if (!button) return () => {};
  const prev = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="adm-spin" aria-hidden="true"></span> ${esc(text)}`;
  return () => { button.disabled = false; button.innerHTML = prev; };
}

