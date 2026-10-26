/**
 * Panel de administración de KOVA (/admin).
 *
 * Pantallas (según el hash de la URL):
 *   #/                 Inventario: lista, buscador, filtros y acciones rápidas.
 *   #/nuevo            Formulario de producto nuevo.
 *   #/editar/<id>      Formulario de un producto existente.
 *   #/duplicar/<id>    Formulario nuevo con los datos de otro producto.
 *
 * Todo cambio se guarda en Supabase y la tienda lo lee de ahí (ver js/services/catalog.js).
 */
import { CONFIG } from '../../js/config.js';
import { categories } from '../../js/data/categories.js';
import { products as repoProducts } from '../../js/data/products.js';
import { formatPrice } from '../../js/utils/format.js';
import { esc, toast } from '../../js/utils/dom.js';
import * as api from './api.js';
import { prepareImage, ACCEPT } from './images.js';

const app = document.getElementById('app');
const dialog = document.getElementById('dialog');

const SIZE_PRESETS = ['XS', 'S', 'M', 'L', 'XL', 'XXL', 'Única'];
const TAG_SUGGESTIONS = ['NEW', 'DROP 01', 'LIMITED', 'RESTOCK', 'SALE'];
const DETAIL_SUGGESTIONS = ['100% algodón', '220 g', 'Fit oversize', 'Hecho en Colombia'];
const ID_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

const state = {
  user: null,
  products: [],
  loaded: false,
  filters: { q: '', category: '', tag: '', status: '' },
  editor: null,      // borrador abierto en el formulario
  busy: false,
};

/* =========================================================================
 * Utilidades
 * ========================================================================= */

/** Rutas del repositorio (assets/…) se ven desde /admin con ../ delante. */
const imgSrc = (url) => (/^(https?:|blob:|data:|\/)/.test(url) ? url : `../${url}`);

const slugify = (text) => text
  .normalize('NFD').replace(/[̀-ͯ]/g, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80);

const categoryLabel = (id) => categories.find((c) => c.id === id)?.label ?? id;

/** Categorías de categories.js + cualquiera que ya usen los productos (para no perderlas). */
function categoryOptions() {
  const list = categories.map((c) => ({ id: c.id, label: c.label }));
  state.products.forEach((p) => { if (!list.some((c) => c.id === p.category)) list.push({ id: p.category, label: p.category }); });
  return list;
}

// form.name y form.id devuelven atributos del propio <form>, no sus campos: por eso este helper.
const field = (form, name) => form.elements.namedItem(name);

const uid = () => Math.random().toString(36).slice(2, 10);

function confirmDialog({ title, body, confirm = 'Confirmar', danger = false, cancel = 'Cancelar' }) {
  return new Promise((resolve) => {
    dialog.innerHTML = `
      <form method="dialog" class="adm-dialog__box">
        <h2 class="adm-dialog__title">${esc(title)}<span class="dot">.</span></h2>
        <div class="adm-dialog__body">${body}</div>
        <div class="adm-dialog__actions">
          <button class="btn btn--line btn--sm" value="cancel">${esc(cancel)}</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'} btn--sm" value="ok">${esc(confirm)}</button>
        </div>
      </form>`;
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok'), { once: true });
    dialog.returnValue = '';
    dialog.showModal();
    dialog.querySelector('[value="cancel"]').focus();
  });
}

function setBusy(button, text) {
  if (!button) return () => {};
  const prev = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="adm-spin" aria-hidden="true"></span> ${esc(text)}`;
  return () => { button.disabled = false; button.innerHTML = prev; };
}

/* =========================================================================
 * Pantallas fuera de sesión
 * ========================================================================= */

function authFrame(inner) {
  app.innerHTML = `
    <main class="adm-auth s-navy grid-lines">
      <div class="adm-auth__card s-arena">
        <img class="adm-auth__logo" src="../${esc(CONFIG.brand.logo)}" alt="KOVA" width="200" height="60">
        ${inner}
      </div>
      <a class="adm-auth__back" href="../index.html"><span class="btn__arrow" aria-hidden="true">←</span> Volver a la tienda</a>
    </main>`;
}

function renderSetup() {
  authFrame(`
    <p class="eyebrow">Panel de administración</p>
    <h1 class="adm-auth__title">Falta conectar la base de datos<span class="dot">.</span></h1>
    <p class="adm-auth__text">El panel guarda los productos en Supabase (base de datos, inicio de sesión e imágenes).
      Mientras no esté conectado, la tienda sigue mostrando los productos de <code>js/data/products.js</code>.</p>
    <ol class="adm-steps">
      <li>Crea un proyecto gratis en <a href="https://supabase.com" target="_blank" rel="noopener">supabase.com</a>.</li>
      <li>En <b>SQL Editor</b> ejecuta el archivo <code>supabase/schema.sql</code>.</li>
      <li>Copia la <b>URL</b> y la clave <b>anon / publishable</b> (Project Settings → API) en <code>CONFIG.backend</code> de <code>js/config.js</code>.</li>
      <li>Crea tu usuario en <b>Authentication → Users</b> y conviértelo en administrador (README, «Primer administrador»).</li>
    </ol>`);
}

function renderLogin(message = '') {
  authFrame(`
    <p class="eyebrow">Acceso privado</p>
    <h1 class="adm-auth__title">Administrar catálogo<span class="dot">.</span></h1>
    <form class="adm-auth__form" data-login novalidate>
      <label class="field"><span class="field__label">Correo</span>
        <input class="field__input" type="email" name="email" autocomplete="username" required></label>
      <label class="field"><span class="field__label">Contraseña</span>
        <input class="field__input" type="password" name="password" autocomplete="current-password" required></label>
      <p class="adm-form-msg" data-msg role="alert">${esc(message)}</p>
      <button class="btn btn--primary btn--block" type="submit">Entrar <i class="ico ico--destellos" aria-hidden="true"></i></button>
      <button class="adm-link" type="button" data-forgot>¿Olvidaste tu contraseña?</button>
    </form>`);
  const form = app.querySelector('[data-login]');
  const msg = form.querySelector('[data-msg]');
  form.email.focus();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = form.email.value.trim();
    const password = form.password.value;
    if (!email || !password) { msg.textContent = 'Escribe tu correo y tu contraseña.'; return; }
    const done = setBusy(form.querySelector('[type="submit"]'), 'Entrando…');
    try {
      await api.signIn(email, password);
      await start();
    } catch (err) {
      msg.textContent = api.friendlyError(err);
      done();
    }
  });
  form.querySelector('[data-forgot]').addEventListener('click', async () => {
    const email = form.email.value.trim();
    if (!email) { msg.textContent = 'Escribe tu correo arriba y vuelve a pulsar «¿Olvidaste tu contraseña?».'; form.email.focus(); return; }
    try {
      await api.sendPasswordReset(email);
      msg.textContent = 'Si el correo es de un administrador, te llegará un enlace para crear una contraseña nueva.';
    } catch (err) { msg.textContent = api.friendlyError(err); }
  });
}

function renderRecovery() {
  authFrame(`
    <p class="eyebrow">Recuperar acceso</p>
    <h1 class="adm-auth__title">Nueva contraseña<span class="dot">.</span></h1>
    <form class="adm-auth__form" data-recovery novalidate>
      <label class="field"><span class="field__label">Contraseña nueva (mínimo 8 caracteres)</span>
        <input class="field__input" type="password" name="password" autocomplete="new-password" minlength="8" required></label>
      <p class="adm-form-msg" data-msg role="alert"></p>
      <button class="btn btn--primary btn--block" type="submit">Guardar contraseña</button>
    </form>`);
  const form = app.querySelector('[data-recovery]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const msg = form.querySelector('[data-msg]');
    if (form.password.value.length < 8) { msg.textContent = 'Usa al menos 8 caracteres.'; return; }
    const done = setBusy(form.querySelector('[type="submit"]'), 'Guardando…');
    try {
      await api.updatePassword(form.password.value);
      history.replaceState(null, '', location.pathname);
      toast('Contraseña actualizada.');
      await start();
    } catch (err) { msg.textContent = api.friendlyError(err); done(); }
  });
}

function renderDenied(email) {
  authFrame(`
    <p class="eyebrow">Sin permisos</p>
    <h1 class="adm-auth__title">Cuenta sin acceso<span class="dot">.</span></h1>
    <p class="adm-auth__text">La cuenta <b>${esc(email)}</b> inició sesión, pero no está registrada como administradora de KOVA.
      Para darle acceso, agrégala a la tabla <code>admins</code> (README, «Primer administrador»).</p>
    <button class="btn btn--line btn--block" type="button" data-out>Cerrar sesión</button>`);
  app.querySelector('[data-out]').addEventListener('click', async () => { await api.signOut(); renderLogin(); });
}

/* =========================================================================
 * Estructura del panel
 * ========================================================================= */

function shell() {
  if (app.querySelector('.adm-shell')) return app.querySelector('[data-view]');
  app.innerHTML = `
    <div class="adm-shell">
      <header class="adm-top s-navy">
        <a class="adm-top__brand" href="#/" aria-label="Inventario">
          <img src="../${esc(CONFIG.brand.logo)}" alt="KOVA" width="200" height="60">
          <span class="adm-top__badge">Admin</span>
        </a>
        <nav class="adm-top__nav" aria-label="Panel">
          <a class="adm-top__link" href="../index.html" target="_blank" rel="noopener">Ver tienda <span aria-hidden="true">↗</span></a>
          <span class="adm-top__user" title="${esc(state.user?.email ?? '')}">${esc(state.user?.email ?? '')}</span>
          <button class="btn btn--line btn--sm" type="button" data-logout>Salir</button>
        </nav>
      </header>
      <main class="adm-main s-arena" data-view></main>
    </div>`;
  app.querySelector('[data-logout]').addEventListener('click', async () => {
    if (!(await leaveEditorOk())) return;
    state.editor = null;
    await api.signOut();
    state.products = [];
    state.loaded = false;
    history.replaceState(null, '', location.pathname);
    renderLogin('Sesión cerrada.');
  });
  return app.querySelector('[data-view]');
}

async function loadProducts() {
  state.products = await api.listProducts();
  state.loaded = true;
}

/* =========================================================================
 * Inventario
 * ========================================================================= */

function filteredProducts() {
  const { q, category, tag, status } = state.filters;
  const needle = slugify(q);
  return state.products.filter((p) => {
    if (needle && !slugify(p.name).includes(needle) && !p.id.includes(needle)) return false;
    if (category && p.category !== category) return false;
    if (tag === '__featured' && !p.featured) return false;
    if (tag === '__none' && p.tag) return false;
    if (tag && !tag.startsWith('__') && p.tag !== tag) return false;
    if (status === 'published' && !p.published) return false;
    if (status === 'hidden' && p.published) return false;
    if (status === 'soldout' && p.available !== false) return false;
    return true;
  });
}

function renderInventory() {
  const view = shell();
  const all = state.products;
  const published = all.filter((p) => p.published).length;
  const tags = [...new Set(all.map((p) => p.tag).filter(Boolean))].sort();
  const missing = repoProducts.filter((p) => !all.some((x) => x.id === p.id));
  const f = state.filters;

  view.innerHTML = `
    <div class="adm-wrap">
      <div class="adm-head">
        <div>
          <p class="eyebrow">Catálogo en línea</p>
          <h1 class="adm-head__title">Inventario<span class="dot">.</span></h1>
        </div>
        <a class="btn btn--primary" href="#/nuevo">Nuevo producto <span class="btn__arrow" aria-hidden="true">+</span></a>
      </div>

      <dl class="adm-stats">
        <div><dt>Productos</dt><dd>${all.length}</dd></div>
        <div><dt>Publicados</dt><dd>${published}</dd></div>
        <div><dt>Ocultos</dt><dd>${all.length - published}</dd></div>
        <div><dt>Destacados</dt><dd>${all.filter((p) => p.featured).length}</dd></div>
      </dl>

      ${!all.length ? `
        <section class="adm-empty grid-lines">
          <i class="ico ico--orbita adm-empty__ico" aria-hidden="true"></i>
          <h2>La base de datos está vacía<span class="dot">.</span></h2>
          <p>Importa los ${repoProducts.length} productos que hoy tiene la tienda (<code>js/data/products.js</code>) con todos sus datos e imágenes.
            Después podrás editarlos desde aquí.</p>
          <button class="btn btn--primary" type="button" data-import>Importar ${repoProducts.length} productos actuales</button>
        </section>` : `
        <div class="adm-toolbar">
          <label class="adm-search">
            <span class="sr-only">Buscar</span>
            <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></svg>
            <input type="search" placeholder="Buscar por nombre o identificador" value="${esc(f.q)}" data-filter="q">
          </label>
          <label class="adm-select"><span class="sr-only">Categoría</span>
            <select data-filter="category">
              <option value="">Todas las categorías</option>
              ${categoryOptions().map((c) => `<option value="${esc(c.id)}"${f.category === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
            </select></label>
          <label class="adm-select"><span class="sr-only">Etiqueta</span>
            <select data-filter="tag">
              <option value="">Todas las etiquetas</option>
              <option value="__featured"${f.tag === '__featured' ? ' selected' : ''}>★ Destacados</option>
              ${tags.map((t) => `<option value="${esc(t)}"${f.tag === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}
              <option value="__none"${f.tag === '__none' ? ' selected' : ''}>Sin etiqueta</option>
            </select></label>
          <div class="adm-seg" role="group" aria-label="Estado">
            ${[['', 'Todos'], ['published', 'Publicados'], ['hidden', 'Ocultos'], ['soldout', 'Agotados']].map(([v, l]) =>
              `<button type="button" data-status="${v}" aria-pressed="${f.status === v}">${l}</button>`).join('')}
          </div>
        </div>
        <div data-list></div>
        <div class="adm-tools">
          ${missing.length ? `<button class="adm-link" type="button" data-import>Importar ${missing.length} producto(s) de products.js que no están en la base</button>` : ''}
          <button class="adm-link" type="button" data-backup>Descargar respaldo (products.js)</button>
        </div>`}
    </div>`;

  renderList();

  view.querySelectorAll('[data-filter]').forEach((el) => el.addEventListener('input', () => {
    state.filters[el.dataset.filter] = el.value;
    renderList();
  }));
  view.querySelectorAll('[data-status]').forEach((el) => el.addEventListener('click', () => {
    state.filters.status = el.dataset.status;
    view.querySelectorAll('[data-status]').forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
    renderList();
  }));
  view.querySelectorAll('[data-import]').forEach((el) => el.addEventListener('click', () => importRepo(el)));
  view.querySelector('[data-backup]')?.addEventListener('click', downloadBackup);
}

function statusPill(p) {
  return p.published
    ? '<span class="adm-pill adm-pill--on">Publicado</span>'
    : '<span class="adm-pill adm-pill--off">Oculto</span>';
}

function renderList() {
  const box = app.querySelector('[data-list]');
  if (!box) return;
  const items = filteredProducts();
  if (!items.length) {
    box.innerHTML = `<p class="adm-none">Ningún producto coincide con la búsqueda o los filtros.
      <button class="adm-link" type="button" data-clear>Limpiar filtros</button></p>`;
    box.querySelector('[data-clear]').addEventListener('click', () => {
      state.filters = { q: '', category: '', tag: '', status: '' };
      renderInventory();
    });
    return;
  }
  box.innerHTML = `
    <p class="adm-count">${items.length} de ${state.products.length} productos</p>
    <ul class="adm-list">
      ${items.map((p) => `
        <li class="adm-row${p.published ? '' : ' is-hidden'}" data-id="${esc(p.id)}">
          <a class="adm-row__thumb" href="#/editar/${encodeURIComponent(p.id)}" tabindex="-1" aria-hidden="true">
            ${p.images[0] ? `<img src="${esc(imgSrc(p.images[0]))}" alt="" loading="lazy" width="80" height="100">` : '<span>Sin imagen</span>'}
          </a>
          <div class="adm-row__main">
            <a class="adm-row__name" href="#/editar/${encodeURIComponent(p.id)}">${esc(p.name)}</a>
            <span class="adm-row__id">${esc(p.id)}</span>
            <span class="adm-row__badges">
              ${p.featured ? '<span class="adm-badge adm-badge--star">★ Destacado</span>' : ''}
              ${p.tag ? `<span class="tag">${esc(p.tag)}</span>` : ''}
              ${p.available === false ? '<span class="tag tag--out">Agotado</span>' : ''}
            </span>
          </div>
          <span class="adm-row__cat">${esc(categoryLabel(p.category))}</span>
          <span class="adm-row__price">${formatPrice(p.price)}</span>
          <span class="adm-row__sizes">${(p.sizes ?? []).map((s) => `<span${p.soldOutSizes?.includes(s) ? ' class="is-out" title="Agotada"' : ''}>${esc(s)}</span>`).join('') || '<em>Sin tallas</em>'}</span>
          <span class="adm-row__status">${statusPill(p)}</span>
          <div class="adm-row__actions">
            <a class="adm-act adm-act--main" href="#/editar/${encodeURIComponent(p.id)}">Editar</a>
            <button class="adm-act" type="button" data-act="toggle">${p.published ? 'Ocultar' : 'Publicar'}</button>
            <a class="adm-act" href="#/duplicar/${encodeURIComponent(p.id)}">Duplicar</a>
            <button class="adm-act adm-act--danger" type="button" data-act="delete">Eliminar</button>
          </div>
        </li>`).join('')}
    </ul>`;
  box.querySelectorAll('[data-act]').forEach((btn) => btn.addEventListener('click', () => {
    const product = state.products.find((p) => p.id === btn.closest('[data-id]').dataset.id);
    if (btn.dataset.act === 'toggle') togglePublished(product, btn);
    if (btn.dataset.act === 'delete') removeProduct(product, btn);
  }));
}

async function togglePublished(product, btn) {
  const next = !product.published;
  const done = setBusy(btn, next ? 'Publicando…' : 'Ocultando…');
  try {
    await api.setPublished(product.id, next);
    product.published = next;
    toast(next ? `«${product.name}» ya se ve en la tienda.` : `«${product.name}» quedó oculto: ya no aparece en la tienda.`);
    renderInventory();
  } catch (err) {
    done();
    toast(api.friendlyError(err));
  }
}

/** URLs de imágenes que ningún otro producto usa (para no borrar fotos compartidas al duplicar). */
const orphanImages = (urls, exceptId) =>
  urls.filter((u) => api.isStoredImage(u) && !state.products.some((p) => p.id !== exceptId && p.images.includes(u)));

async function removeProduct(product, btn) {
  const ok = await confirmDialog({
    title: 'Eliminar producto',
    body: `<p>¿Eliminar <b>${esc(product.name)}</b> (<code>${esc(product.id)}</code>) del catálogo?</p>
      <p>Se borra de la tienda y de la base de datos, junto con sus imágenes subidas. <b>No se puede deshacer.</b>
      Si solo quieres que no se vea, usa <b>Ocultar</b>.</p>`,
    confirm: 'Sí, eliminar',
    danger: true,
  });
  if (!ok) return;
  const done = setBusy(btn, 'Eliminando…');
  try {
    await api.deleteProduct(product.id);
    const orphans = orphanImages(product.images, product.id);
    state.products = state.products.filter((p) => p.id !== product.id);
    try { await api.removeImages(orphans); } catch (err) { console.warn('No se pudieron borrar algunas imágenes', err); }
    toast(`«${product.name}» eliminado.`);
    renderInventory();
  } catch (err) {
    done();
    toast(api.friendlyError(err));
  }
}

async function importRepo(btn) {
  const missing = repoProducts.filter((p) => !state.products.some((x) => x.id === p.id));
  if (!missing.length) return toast('Todos los productos de products.js ya están en la base.');
  const ok = await confirmDialog({
    title: 'Importar productos',
    body: `<p>Se copiarán a la base de datos ${missing.length} producto(s) de <code>js/data/products.js</code>, con todos sus campos:</p>
      <ul class="adm-dialog__list">${missing.map((p) => `<li>${esc(p.name)} · ${formatPrice(p.price)}</li>`).join('')}</ul>
      <p>Quedan publicados. No se modifica ni se borra ningún producto existente.</p>`,
    confirm: 'Importar',
  });
  if (!ok) return;
  const done = setBusy(btn, 'Importando…');
  try {
    const start = state.products.reduce((m, p) => Math.max(m, p.position ?? 0), -1) + 1;
    const n = await api.importProducts(missing, start);
    await loadProducts();
    toast(`${n} producto(s) importados.`);
    renderInventory();
  } catch (err) {
    done();
    toast(api.friendlyError(err));
  }
}

/** Genera un products.js con el catálogo actual, para actualizar el respaldo del repositorio. */
function downloadBackup() {
  const clean = state.products.map(({ position, updatedAt, ...p }) => (p.published ? (({ published, ...rest }) => rest)(p) : p));
  const text = `/**
 * RESPALDO DEL CATÁLOGO — generado desde el panel /admin el ${new Date().toLocaleString('es-CO')}.
 * La tienda lee los productos de la base de datos (Supabase). Este archivo solo se usa si la base
 * no responde. Para actualizar el respaldo, reemplaza js/data/products.js con este archivo.
 */
export const products = ${JSON.stringify(clean, null, 2)};
`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }));
  a.download = 'products.js';
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/* =========================================================================
 * Formulario de producto
 * ========================================================================= */

function newDraft(base = null, { duplicate = false } = {}) {
  const src = base ?? {};
  const draft = {
    isNew: !base || duplicate,
    originalId: base && !duplicate ? base.id : null,
    id: src.id ?? '',
    idTouched: Boolean(base),
    name: src.name ?? '',
    category: src.category ?? categories[0]?.id ?? '',
    price: src.price ?? '',
    description: src.description ?? '',
    tag: src.tag ?? '',
    featured: Boolean(src.featured),
    available: src.available !== false,
    published: base ? src.published !== false : true,
    sizes: [...(src.sizes ?? (base ? [] : ['S', 'M', 'L', 'XL']))],
    soldOutSizes: [...(src.soldOutSizes ?? [])],
    details: [...(src.details ?? [])],
    colors: (src.colors ?? []).map((c) => ({ ...c })),
    images: (src.images ?? []).map((url) => ({ key: uid(), url })),
    errors: {},
  };
  if (duplicate) {
    let id = `${src.id}-copia`;
    for (let n = 2; state.products.some((p) => p.id === id); n++) id = `${src.id}-copia-${n}`;
    Object.assign(draft, { id, name: `${src.name} (copia)`, published: false });
  }
  draft.snapshot = serialize(draft);
  return draft;
}

const serialize = (d) => JSON.stringify([d.id, d.name, d.category, String(d.price), d.description, d.tag, d.featured, d.available,
  d.published, d.sizes, d.soldOutSizes, d.details, d.colors, d.images.map((i) => i.url ?? i.key)]);
const isDirty = () => Boolean(state.editor && serialize(state.editor) !== state.editor.snapshot);

async function leaveEditorOk() {
  if (!isDirty()) return true;
  return confirmDialog({
    title: 'Cambios sin guardar',
    body: '<p>Tienes cambios sin guardar en este producto. Si sales ahora, se perderán.</p>',
    confirm: 'Salir sin guardar',
    cancel: 'Seguir editando',
    danger: true,
  });
}

function releaseDraft(draft) {
  draft?.images.forEach((img) => img.preview && URL.revokeObjectURL(img.preview));
}

function renderEditor(draft) {
  state.editor = draft;
  const view = shell();
  const d = draft;
  const title = d.isNew ? 'Nuevo producto' : 'Editar producto';
  view.innerHTML = `
    <form class="adm-wrap adm-editor" data-editor novalidate>
      <div class="adm-head">
        <div>
          <a class="adm-crumb" href="#/"><span class="btn__arrow" aria-hidden="true">←</span> Inventario</a>
          <h1 class="adm-head__title">${title}<span class="dot">.</span></h1>
        </div>
        ${!d.isNew ? `<a class="adm-link" href="../producto.html#${encodeURIComponent(d.originalId)}" target="_blank" rel="noopener">Ver en la tienda ↗</a>` : ''}
      </div>

      <div class="adm-alert" data-summary role="alert" hidden></div>

      <div class="adm-editor__grid">
        <div class="adm-editor__col">
          <section class="adm-card">
            <h2 class="adm-card__title"><span>01</span> Información</h2>
            <label class="field" data-field="name"><span class="field__label">Nombre del producto <span>*</span></span>
              <input class="field__input" name="name" maxlength="120" value="${esc(d.name)}" placeholder="Ej. Cyber Star Tee" required>
              <span class="field__error" data-error="name"></span></label>
            <label class="field" data-field="id"><span class="field__label">Identificador (URL) <span>*</span></span>
              <span class="adm-prefix"><span>producto.html#</span><input class="field__input" name="id" maxlength="80" value="${esc(d.id)}" ${d.isNew ? '' : 'readonly'} autocapitalize="off" spellcheck="false"></span>
              <span class="field__hint">${d.isNew ? 'Se crea solo a partir del nombre. Solo minúsculas, números y guiones; debe ser único.' : 'El identificador no se cambia para no romper enlaces ni carritos guardados. Para usar otro, duplica el producto.'}</span>
              <span class="field__error" data-error="id"></span></label>
            <div class="adm-two">
              <label class="field" data-field="category"><span class="field__label">Categoría <span>*</span></span>
                <select class="field__input" name="category">
                  ${categoryOptions().map((c) => `<option value="${esc(c.id)}"${d.category === c.id ? ' selected' : ''}>${esc(c.label)}</option>`).join('')}
                </select>
                <span class="field__error" data-error="category"></span></label>
              <label class="field" data-field="price"><span class="field__label">Precio (COP) <span>*</span></span>
                <span class="adm-prefix"><span>$</span><input class="field__input" name="price" inputmode="numeric" value="${esc(d.price === '' ? '' : Number(d.price).toLocaleString('es-CO'))}" placeholder="85.000"></span>
                <span class="field__hint" data-price-preview></span>
                <span class="field__error" data-error="price"></span></label>
            </div>
            <label class="field" data-field="description"><span class="field__label">Descripción <span>*</span></span>
              <textarea class="field__input" name="description" rows="4" maxlength="1200" placeholder="Cómo es la prenda, material, corte…">${esc(d.description)}</textarea>
              <span class="field__error" data-error="description"></span></label>
          </section>

          <section class="adm-card">
            <h2 class="adm-card__title"><span>02</span> Imágenes <small>La primera es la principal; la segunda aparece al pasar el cursor por la tarjeta.</small></h2>
            <div data-images></div>
            <span class="field__error" data-error="images"></span>
            <input type="file" accept="${ACCEPT}" multiple hidden data-file-add>
            <input type="file" accept="${ACCEPT}" hidden data-file-replace>
          </section>

          <section class="adm-card">
            <h2 class="adm-card__title"><span>03</span> Tallas</h2>
            <div data-sizes></div>
          </section>
        </div>

        <div class="adm-editor__col">
          <section class="adm-card">
            <h2 class="adm-card__title"><span>04</span> Estado</h2>
            <label class="adm-switch"><input type="checkbox" name="published"${d.published ? ' checked' : ''}><span class="adm-switch__ui"></span>
              <span><b>Publicado</b><small>Visible en la tienda. Desactívalo para ocultarlo sin borrarlo.</small></span></label>
            <label class="adm-switch"><input type="checkbox" name="featured"${d.featured ? ' checked' : ''}><span class="adm-switch__ui"></span>
              <span><b>Destacado</b><small>Aparece en la sección «Destacados» de la portada.</small></span></label>
            <label class="adm-switch"><input type="checkbox" name="available"${d.available ? ' checked' : ''}><span class="adm-switch__ui"></span>
              <span><b>Disponible</b><small>Desactívalo para mostrarlo como «Agotado» (no se puede comprar).</small></span></label>
            <label class="field adm-tagfield" data-field="tag"><span class="field__label">Etiqueta comercial (opcional)</span>
              <input class="field__input" name="tag" maxlength="24" value="${esc(d.tag)}" placeholder="NEW, DROP 01, LIMITED…" list="tag-suggestions" autocapitalize="characters">
              <datalist id="tag-suggestions">${[...new Set([...TAG_SUGGESTIONS, ...state.products.map((p) => p.tag).filter(Boolean)])].map((t) => `<option value="${esc(t)}">`).join('')}</datalist>
              <span class="adm-chips adm-chips--sm">${TAG_SUGGESTIONS.map((t) => `<button type="button" class="adm-chip" data-tag="${esc(t)}">${esc(t)}</button>`).join('')}</span>
              <span class="field__error" data-error="tag"></span></label>
          </section>

          <section class="adm-card">
            <h2 class="adm-card__title"><span>05</span> Detalles <small>Datos cortos de la etiqueta del producto.</small></h2>
            <div data-details></div>
          </section>

          <section class="adm-card">
            <h2 class="adm-card__title"><span>06</span> Colores <small>Opcional. Si agregas colores, el cliente elige uno al comprar.</small></h2>
            <div data-colors></div>
          </section>

          <section class="adm-card adm-preview">
            <h2 class="adm-card__title"><span>07</span> Vista previa</h2>
            <div data-preview></div>
          </section>
        </div>
      </div>

      <div class="adm-savebar s-navy">
        <span class="adm-savebar__state" data-dirty></span>
        <div class="adm-savebar__actions">
          <a class="btn btn--line btn--sm" href="#/" data-cancel>Cancelar</a>
          <button class="btn btn--primary btn--sm" type="submit" data-save>${d.isNew ? 'Crear producto' : 'Guardar cambios'}</button>
        </div>
      </div>
    </form>`;

  bindEditor(view.querySelector('[data-editor]'));
}

function bindEditor(form) {
  const d = state.editor;
  const fileAdd = form.querySelector('[data-file-add]');
  const fileReplace = form.querySelector('[data-file-replace]');
  let replaceKey = null;

  const refresh = () => {
    renderImages(form);
    renderSizes(form);
    renderDetails(form);
    renderColors(form);
    renderPreview(form);
    updateDirty(form);
  };

  form.addEventListener('input', (e) => {
    const t = e.target;
    if (!t.name) return;
    if (t.name === 'name') {
      d.name = t.value;
      if (d.isNew && !d.idTouched) { d.id = slugify(t.value); field(form, 'id').value = d.id; }
    } else if (t.name === 'id') {
      d.idTouched = true;
      d.id = t.value;
    } else if (t.name === 'price') {
      const digits = t.value.replace(/\D/g, '').slice(0, 9);
      d.price = digits === '' ? '' : Number(digits);
      const pos = t.value.length - t.selectionStart;
      t.value = digits === '' ? '' : Number(digits).toLocaleString('es-CO');
      t.setSelectionRange(Math.max(0, t.value.length - pos), Math.max(0, t.value.length - pos));
    } else if (t.name === 'tag') {
      d.tag = t.value.toUpperCase();
      if (t.value !== d.tag) { const p = t.selectionStart; t.value = d.tag; t.setSelectionRange(p, p); }
    } else if (['published', 'featured', 'available'].includes(t.name)) {
      d[t.name] = t.checked;
    } else if (['category', 'description'].includes(t.name)) {
      d[t.name] = t.value;
    } else if (t.name === 'detail') {
      d.details[Number(t.dataset.index)] = t.value;
    } else if (t.name === 'color-name' || t.name === 'color-hex') {
      d.colors[Number(t.dataset.index)][t.name === 'color-name' ? 'name' : 'hex'] = t.value;
    } else if (t.name === 'custom-size') {
      return;
    }
    revalidate(form);
    renderPreview(form);
    updateDirty(form);
  });
  form.category.addEventListener('change', () => { d.category = form.category.value; updateDirty(form); });

  form.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.tag) { d.tag = d.tag === b.dataset.tag ? '' : b.dataset.tag; form.tag.value = d.tag; renderPreview(form); updateDirty(form); }
    if (b.dataset.size) toggleSize(b.dataset.size);
    if (b.dataset.soldout) toggleSoldOut(b.dataset.soldout);
    if (b.dataset.removeSize) { removeSize(b.dataset.removeSize); }
    if (b.hasAttribute('data-add-size')) addCustomSize(form);
    if (b.dataset.detailAdd !== undefined) {
      d.details.push(b.dataset.detailAdd);
      renderDetails(form);
      if (!b.dataset.detailAdd) form.querySelector(`[name="detail"][data-index="${d.details.length - 1}"]`)?.focus();
    }
    if (b.dataset.detailRemove) { d.details.splice(Number(b.dataset.detailRemove), 1); renderDetails(form); }
    if (b.hasAttribute('data-color-add')) { d.colors.push({ name: '', hex: '#00001f' }); renderColors(form); form.querySelector(`[name="color-name"][data-index="${d.colors.length - 1}"]`)?.focus(); }
    if (b.dataset.colorRemove) { d.colors.splice(Number(b.dataset.colorRemove), 1); renderColors(form); }
    if (b.hasAttribute('data-img-add')) fileAdd.click();
    if (b.dataset.imgMove) moveImage(b.dataset.key, Number(b.dataset.imgMove));
    if (b.dataset.imgRemove) removeImage(b.dataset.imgRemove);
    if (b.dataset.imgReplace) { replaceKey = b.dataset.imgReplace; fileReplace.click(); }
    if (b.dataset.imgFirst) { const i = d.images.findIndex((x) => x.key === b.dataset.imgFirst); moveImage(b.dataset.imgFirst, -i); }
    if (b.dataset.size || b.dataset.soldout || b.dataset.removeSize || b.hasAttribute('data-add-size') || b.dataset.detailRemove
      || b.dataset.detailAdd !== undefined || b.hasAttribute('data-color-add') || b.dataset.colorRemove) { renderPreview(form); updateDirty(form); revalidate(form); }
  });

  form.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.name === 'custom-size') { e.preventDefault(); addCustomSize(form); }
    if (e.key === 'Enter' && e.target.name === 'detail') {
      e.preventDefault();
      d.details.push('');
      renderDetails(form);
      form.querySelector(`[name="detail"][data-index="${d.details.length - 1}"]`)?.focus();
    }
  });

  function toggleSize(size) {
    if (d.sizes.includes(size)) return removeSize(size);
    d.sizes.push(size);
    // Orden natural: tallas estándar primero, luego las personalizadas en el orden en que se agregaron.
    const rank = (s) => (SIZE_PRESETS.includes(s) ? SIZE_PRESETS.indexOf(s) : 100);
    d.sizes = d.sizes.map((s, i) => [s, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([s]) => s);
    renderSizes(form);
  }
  function removeSize(size) {
    d.sizes = d.sizes.filter((s) => s !== size);
    d.soldOutSizes = d.soldOutSizes.filter((s) => s !== size);
    renderSizes(form);
  }
  function toggleSoldOut(size) {
    d.soldOutSizes = d.soldOutSizes.includes(size) ? d.soldOutSizes.filter((s) => s !== size) : [...d.soldOutSizes, size];
    renderSizes(form);
  }

  /* --- Imágenes --- */
  async function addFiles(files, { replace = null } = {}) {
    const list = [...files];
    if (!list.length) return;
    const errors = [];
    for (const file of list) {
      try {
        const blob = await prepareImage(file);
        const entry = { key: uid(), file: blob, name: file.name, preview: URL.createObjectURL(blob) };
        if (replace) {
          const i = d.images.findIndex((x) => x.key === replace);
          if (i >= 0) {
            if (d.images[i].preview) URL.revokeObjectURL(d.images[i].preview);
            d.images.splice(i, 1, entry);
          }
        } else d.images.push(entry);
      } catch (err) { errors.push(err.message); }
    }
    if (errors.length) toast(errors.join(' '));
    refresh();
    revalidate(form);
  }
  fileAdd.addEventListener('change', () => { addFiles(fileAdd.files); fileAdd.value = ''; });
  fileReplace.addEventListener('change', () => { addFiles(fileReplace.files, { replace: replaceKey }); fileReplace.value = ''; });

  function moveImage(key, delta) {
    const i = d.images.findIndex((x) => x.key === key);
    const j = Math.min(d.images.length - 1, Math.max(0, i + delta));
    if (i < 0 || i === j) return;
    const [item] = d.images.splice(i, 1);
    d.images.splice(j, 0, item);
    refresh();
    form.querySelector(`[data-img="${key}"] [data-img-move="${delta < 0 ? -1 : 1}"]`)?.focus();
  }
  function removeImage(key) {
    const i = d.images.findIndex((x) => x.key === key);
    if (i < 0) return;
    if (d.images[i].preview) URL.revokeObjectURL(d.images[i].preview);
    d.images.splice(i, 1);
    refresh();
  }

  // Arrastrar archivos desde el computador y reordenar arrastrando miniaturas.
  const imagesBox = form.querySelector('[data-images]');
  let dragKey = null;
  imagesBox.addEventListener('dragstart', (e) => {
    const tile = e.target.closest('[data-img]');
    if (!tile) return;
    dragKey = tile.dataset.img;
    e.dataTransfer.effectAllowed = 'move';
    tile.classList.add('is-dragging');
  });
  imagesBox.addEventListener('dragend', () => { dragKey = null; imagesBox.querySelectorAll('.is-dragging,.is-over').forEach((el) => el.classList.remove('is-dragging', 'is-over')); });
  imagesBox.addEventListener('dragover', (e) => {
    e.preventDefault();
    imagesBox.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));
    (e.target.closest('[data-img]') ?? e.target.closest('.adm-drop'))?.classList.add('is-over');
  });
  imagesBox.addEventListener('dragleave', (e) => { if (!imagesBox.contains(e.relatedTarget)) imagesBox.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over')); });
  imagesBox.addEventListener('drop', (e) => {
    e.preventDefault();
    imagesBox.querySelectorAll('.is-over').forEach((el) => el.classList.remove('is-over'));
    if (e.dataTransfer.files?.length) return addFiles(e.dataTransfer.files);
    const target = e.target.closest('[data-img]');
    if (!dragKey || !target || target.dataset.img === dragKey) return;
    const from = d.images.findIndex((x) => x.key === dragKey);
    const to = d.images.findIndex((x) => x.key === target.dataset.img);
    const [item] = d.images.splice(from, 1);
    d.images.splice(to, 0, item);
    refresh();
  });

  form.addEventListener('submit', (e) => { e.preventDefault(); saveDraft(form); });
  form.querySelector('[data-cancel]').addEventListener('click', async (e) => {
    e.preventDefault();
    if (await leaveEditorOk()) { releaseDraft(d); state.editor = null; go('#/'); }
  });

  refresh();
  if (d.isNew && !d.name) field(form, 'name').focus();
}

function addCustomSize(form) {
  const d = state.editor;
  const input = form.querySelector('[name="custom-size"]');
  const size = input.value.trim().toUpperCase().slice(0, 12);
  if (!size) return input.focus();
  if (d.sizes.includes(size)) { toast(`La talla ${size} ya está agregada.`); return; }
  d.sizes.push(size);
  input.value = '';
  renderSizes(form);
  renderPreview(form);
  updateDirty(form);
  form.querySelector('[name="custom-size"]').focus();
}

function renderImages(form) {
  const d = state.editor;
  const box = form.querySelector('[data-images]');
  const role = (i) => (i === 0 ? 'Principal' : i === 1 ? 'Al pasar el cursor' : `Galería ${i + 1}`);
  box.innerHTML = `
    <ol class="adm-imgs">
      ${d.images.map((img, i) => `
        <li class="adm-img" data-img="${img.key}" draggable="true">
          <div class="adm-img__media">
            <img src="${esc(img.preview ?? imgSrc(img.url))}" alt="${esc(role(i))}" loading="lazy">
            <span class="adm-img__num">${String(i + 1).padStart(2, '0')}</span>
            ${img.file ? '<span class="adm-img__new">Nueva · se sube al guardar</span>' : ''}
          </div>
          <span class="adm-img__role">${role(i)}</span>
          <div class="adm-img__actions">
            <button type="button" class="adm-iconbtn" data-img-move="-1" data-key="${img.key}" aria-label="Mover a la izquierda"${i === 0 ? ' disabled' : ''}>←</button>
            <button type="button" class="adm-iconbtn" data-img-move="1" data-key="${img.key}" aria-label="Mover a la derecha"${i === d.images.length - 1 ? ' disabled' : ''}>→</button>
            ${i > 0 ? `<button type="button" class="adm-iconbtn" data-img-first="${img.key}" aria-label="Usar como principal" title="Usar como principal">★</button>` : ''}
            <button type="button" class="adm-iconbtn" data-img-replace="${img.key}" aria-label="Reemplazar imagen" title="Reemplazar">⟳</button>
            <button type="button" class="adm-iconbtn adm-iconbtn--danger" data-img-remove="${img.key}" aria-label="Quitar imagen" title="Quitar">✕</button>
          </div>
        </li>`).join('')}
      <li class="adm-drop">
        <button type="button" data-img-add>
          <i class="ico ico--destellos" aria-hidden="true"></i>
          <b>Subir imágenes</b>
          <small>Haz clic o arrastra fotos aquí · JPG, PNG, WebP o SVG · proporción 4:5 recomendada</small>
        </button>
      </li>
    </ol>
    ${d.images.length > 1 ? '<p class="field__hint">Arrastra las miniaturas o usa las flechas para cambiar el orden.</p>' : ''}`;
}

function renderSizes(form) {
  const d = state.editor;
  const box = form.querySelector('[data-sizes]');
  const custom = d.sizes.filter((s) => !SIZE_PRESETS.includes(s));
  box.innerHTML = `
    <p class="field__label">Tallas disponibles (pulsa para agregar o quitar)</p>
    <div class="adm-chips">
      ${[...SIZE_PRESETS, ...custom].map((s) => `<button type="button" class="adm-chip adm-chip--size" data-size="${esc(s)}" aria-pressed="${d.sizes.includes(s)}">${esc(s)}</button>`).join('')}
    </div>
    <div class="adm-inline">
      <input class="field__input" name="custom-size" maxlength="12" placeholder="Otra talla (ej. 3XL, 28, 6-8)" aria-label="Otra talla">
      <button type="button" class="btn btn--line btn--sm" data-add-size>Agregar</button>
    </div>
    ${d.sizes.length ? `
      <p class="field__label">Marca las tallas agotadas (se ven tachadas y no se pueden elegir)</p>
      <div class="adm-chips">
        ${d.sizes.map((s) => `<button type="button" class="adm-chip adm-chip--out" data-soldout="${esc(s)}" aria-pressed="${d.soldOutSizes.includes(s)}">${esc(s)}</button>`).join('')}
      </div>` : '<p class="field__hint">Sin tallas: el producto se compra sin elegir talla (útil para accesorios).</p>'}`;
}

function renderDetails(form) {
  const d = state.editor;
  const box = form.querySelector('[data-details]');
  const unused = DETAIL_SUGGESTIONS.filter((s) => !d.details.includes(s));
  box.innerHTML = `
    <ul class="adm-rows">
      ${d.details.map((text, i) => `
        <li class="adm-inline">
          <input class="field__input" name="detail" data-index="${i}" maxlength="60" value="${esc(text)}" placeholder="Ej. 100% algodón" aria-label="Detalle ${i + 1}">
          <button type="button" class="adm-iconbtn adm-iconbtn--danger" data-detail-remove="${i}" aria-label="Quitar detalle">✕</button>
        </li>`).join('')}
    </ul>
    <div class="adm-chips adm-chips--sm">
      <button type="button" class="adm-chip adm-chip--add" data-detail-add="">+ Agregar detalle</button>
      ${unused.map((s) => `<button type="button" class="adm-chip" data-detail-add="${esc(s)}">+ ${esc(s)}</button>`).join('')}
    </div>`;
}

function renderColors(form) {
  const d = state.editor;
  const box = form.querySelector('[data-colors]');
  box.innerHTML = `
    <ul class="adm-rows">
      ${d.colors.map((c, i) => `
        <li class="adm-inline">
          <input type="color" class="adm-color" name="color-hex" data-index="${i}" value="${esc(/^#[0-9a-f]{6}$/i.test(c.hex) ? c.hex : '#00001f')}" aria-label="Color ${i + 1}">
          <input class="field__input" name="color-name" data-index="${i}" maxlength="30" value="${esc(c.name)}" placeholder="Nombre (ej. Azul marino)" aria-label="Nombre del color ${i + 1}">
          <button type="button" class="adm-iconbtn adm-iconbtn--danger" data-color-remove="${i}" aria-label="Quitar color">✕</button>
        </li>`).join('')}
    </ul>
    <span class="field__error" data-error="colors"></span>
    <div class="adm-chips adm-chips--sm"><button type="button" class="adm-chip adm-chip--add" data-color-add>+ Agregar color</button></div>`;
  showErrors(form);
}

/** Tarjeta parecida a la de la tienda, para ver cómo quedará. */
function renderPreview(form) {
  const d = state.editor;
  const box = form.querySelector('[data-preview]');
  const [first, second] = d.images;
  const src = (img) => (img ? esc(img.preview ?? imgSrc(img.url)) : '');
  const soldOut = !d.available || (d.sizes.length && d.sizes.every((s) => d.soldOutSizes.includes(s)));
  box.innerHTML = `
    <div class="adm-pcard${second ? ' has-back' : ''}">
      <div class="adm-pcard__media">
        ${first ? `<img src="${src(first)}" alt="">` : '<span class="adm-pcard__noimg">Sin imagen</span>'}
        ${second ? `<img class="adm-pcard__back" src="${src(second)}" alt="">` : ''}
        ${soldOut ? '<span class="tag tag--out adm-pcard__tag">Agotado</span>' : d.tag ? `<span class="tag adm-pcard__tag">${esc(d.tag)}</span>` : ''}
      </div>
      <div class="adm-pcard__info">
        <span class="adm-pcard__sizes">${d.sizes.map((s) => `<span${d.soldOutSizes.includes(s) ? ' class="is-out"' : ''}>${esc(s)}</span>`).join('')}</span>
        <strong>${esc(d.name || 'Nombre del producto')}</strong>
        <span>${d.price === '' ? '$—' : formatPrice(Number(d.price))}</span>
      </div>
    </div>
    <p class="field__hint">${d.published ? 'Se verá en la tienda al guardar.' : 'Oculto: no se verá en la tienda.'}${d.featured ? ' Aparece en Destacados.' : ''}</p>`;
}

function updateDirty(form) {
  const el = form.querySelector('[data-dirty]');
  const dirty = isDirty();
  el.textContent = dirty ? '● Cambios sin guardar' : state.editor.isNew ? 'Producto nuevo' : 'Sin cambios';
  el.classList.toggle('is-dirty', dirty);
}

/* --- Validación --- */
/** Limpia espacios sobrantes antes de validar y guardar. */
function normalize(d) {
  d.name = d.name.trim().replace(/\s+/g, ' ');
  d.id = d.id.trim();
  d.description = d.description.trim();
  d.tag = d.tag.trim();
  d.details = d.details.map((x) => x.trim()).filter(Boolean);
}

/** Devuelve { campo: mensaje } sin modificar el borrador. */
function validate(d) {
  const e = {};
  const name = d.name.trim();
  const id = d.id.trim();
  if (!name) e.name = 'Escribe el nombre del producto.';
  if (!id) e.id = 'El identificador es obligatorio.';
  else if (!ID_PATTERN.test(id)) e.id = 'Usa solo minúsculas, números y guiones (ej. cyber-star-tee). Sin espacios ni tildes.';
  else if (d.isNew && state.products.some((p) => p.id === id)) e.id = `Ya existe un producto con el identificador «${id}». Usa otro.`;
  if (!d.category) e.category = 'Elige una categoría.';
  if (d.price === '' || d.price === null) e.price = 'Escribe el precio en pesos.';
  else if (!Number.isInteger(d.price) || d.price <= 0) e.price = 'El precio debe ser un número entero mayor que 0.';
  else if (d.price < 1000) e.price = 'El precio parece muy bajo: escríbelo completo en pesos (ej. 85000).';
  if (!d.description.trim()) e.description = 'Escribe una descripción: aparece en la página del producto.';
  if (!d.images.length) e.images = 'Agrega al menos una imagen.';
  if (d.colors.some((c) => !c.name.trim())) e.colors = 'Cada color necesita un nombre.';
  return e;
}

/** Tras un intento de guardar, quita en vivo los avisos que ya se corrigieron. */
function revalidate(form) {
  const d = state.editor;
  if (!d || !Object.keys(d.errors).length) return;
  const now = validate(d);
  d.errors = Object.fromEntries(Object.keys(d.errors).filter((k) => now[k]).map((k) => [k, now[k]]));
  showErrors(form);
}

function showErrors(form) {
  const d = state.editor;
  form.querySelectorAll('[data-error]').forEach((el) => {
    el.textContent = d.errors[el.dataset.error] ?? '';
    el.closest('.field')?.classList.toggle('is-error', Boolean(d.errors[el.dataset.error]));
  });
  const summary = form.querySelector('[data-summary]');
  const msgs = Object.values(d.errors);
  summary.hidden = !msgs.length;
  summary.innerHTML = msgs.length ? `<b>Revisa ${msgs.length === 1 ? 'este dato' : `estos ${msgs.length} datos`} antes de guardar:</b><ul>${msgs.map((m) => `<li>${esc(m)}</li>`).join('')}</ul>` : '';
}

/* --- Guardar --- */
async function saveDraft(form) {
  const d = state.editor;
  if (state.busy) return;
  normalize(d);
  d.errors = validate(d);
  field(form, 'name').value = d.name;
  showErrors(form);
  if (Object.keys(d.errors).length) {
    const first = Object.keys(d.errors)[0];
    (form.querySelector(`[name="${first}"]`) ?? form.querySelector(`[data-error="${first}"]`))?.focus?.();
    form.querySelector('[data-summary]').scrollIntoView({ behavior: 'smooth', block: 'center' });
    return;
  }

  const btn = form.querySelector('[data-save]');
  state.busy = true;
  const done = setBusy(btn, 'Guardando…');
  const uploaded = [];
  try {
    // 1. Subir imágenes nuevas.
    const pending = d.images.filter((img) => img.file);
    let n = 0;
    for (const img of pending) {
      btn.lastChild.textContent = ` Subiendo imagen ${++n} de ${pending.length}…`;
      img.uploadedUrl = await api.uploadImage(d.id, img.file);
      uploaded.push(img.uploadedUrl);
    }
    btn.lastChild.textContent = ' Guardando…';

    // 2. Guardar el producto.
    const product = {
      id: d.id,
      name: d.name,
      category: d.category,
      price: d.price,
      images: d.images.map((img) => img.uploadedUrl ?? img.url),
      description: d.description,
      featured: d.featured,
      published: d.published,
      available: d.available,
    };
    if (d.tag) product.tag = d.tag;
    if (d.sizes.length) product.sizes = d.sizes;
    if (d.soldOutSizes.length) product.soldOutSizes = d.soldOutSizes.filter((s) => d.sizes.includes(s));
    if (d.details.length) product.details = d.details;
    if (d.colors.length) product.colors = d.colors.map((c) => ({ name: c.name.trim(), hex: c.hex }));

    const previous = d.isNew ? null : state.products.find((p) => p.id === d.originalId);
    if (d.isNew) {
      const position = state.products.reduce((m, p) => Math.max(m, p.position ?? 0), -1) + 1;
      await api.createProduct(product, position);
    } else {
      await api.updateProduct(d.originalId, product, previous?.position ?? 0);
    }

    // 3. Borrar del almacenamiento las imágenes que se quitaron (si ningún otro producto las usa).
    if (previous) {
      const removed = previous.images.filter((u) => !product.images.includes(u));
      try { await api.removeImages(orphanImages(removed, previous.id)); } catch (err) { console.warn('No se pudieron borrar imágenes antiguas', err); }
    }

    releaseDraft(d);
    state.editor = null;
    await loadProducts();
    toast(d.isNew ? `«${product.name}» creado${product.published ? ' y publicado' : ' (oculto)'}.` : `Cambios guardados en «${product.name}».`);
    go('#/');
  } catch (err) {
    // Si falló después de subir imágenes, se borran para no dejar archivos sueltos.
    if (uploaded.length) api.removeImages(uploaded).catch(() => {});
    d.images.forEach((img) => delete img.uploadedUrl);
    done();
    const msg = api.friendlyError(err);
    if (/identificador/.test(msg)) { d.errors.id = msg; showErrors(form); }
    toast(msg);
  } finally {
    state.busy = false;
  }
}

/* =========================================================================
 * Navegación
 * ========================================================================= */

let lastHash = location.hash;
let ignoreHash = false;
const go = (hash) => {
  if (location.hash === hash) route();
  else location.hash = hash;
};

async function route() {
  if (!state.user) return;
  const hash = location.hash || '#/';
  const [, view, rawId] = hash.match(/^#\/([a-z]*)\/?(.*)$/) ?? [];
  const id = decodeURIComponent(rawId ?? '');
  if (!state.loaded) {
    shell().innerHTML = '<div class="adm-boot adm-boot--light"><i class="ico ico--destellos twinkle" aria-hidden="true"></i><span>Cargando productos…</span></div>';
    try { await loadProducts(); } catch (err) {
      shell().innerHTML = `<div class="adm-wrap"><div class="adm-alert"><b>No se pudieron cargar los productos.</b><p>${esc(api.friendlyError(err))}</p>
        <button class="btn btn--primary btn--sm" type="button" data-retry>Reintentar</button></div></div>`;
      app.querySelector('[data-retry]').addEventListener('click', route);
      return;
    }
  }
  if (view === 'nuevo') return renderEditor(newDraft());
  if (view === 'editar' || view === 'duplicar') {
    const product = state.products.find((p) => p.id === id);
    if (!product) { toast('Ese producto no existe (quizá se eliminó).'); return go('#/'); }
    return renderEditor(newDraft(product, { duplicate: view === 'duplicar' }));
  }
  state.editor = null;
  renderInventory();
}

window.addEventListener('hashchange', async () => {
  if (ignoreHash) { ignoreHash = false; return; }
  if (state.editor && !(await leaveEditorOk())) {
    ignoreHash = true;
    location.hash = lastHash;
    return;
  }
  if (state.editor) releaseDraft(state.editor);
  state.editor = null;
  lastHash = location.hash;
  route();
});

window.addEventListener('beforeunload', (e) => {
  if (isDirty()) { e.preventDefault(); e.returnValue = ''; }
});

/* =========================================================================
 * Inicio
 * ========================================================================= */

async function start() {
  const session = await api.getSession();
  if (!session) { state.user = null; return renderLogin(); }
  state.user = session.user;
  let admin = false;
  try { admin = await api.isAdmin(); } catch (err) {
    return authFrame(`<h1 class="adm-auth__title">Sin conexión<span class="dot">.</span></h1>
      <p class="adm-auth__text">${esc(api.friendlyError(err))}</p>
      <button class="btn btn--primary btn--block" type="button" onclick="location.reload()">Reintentar</button>`);
  }
  if (!admin) return renderDenied(session.user.email);
  lastHash = location.hash;
  route();
}

async function boot() {
  if (!api.isConfigured()) return renderSetup();
  if (!window.supabase?.createClient) {
    return authFrame('<h1 class="adm-auth__title">Error al cargar<span class="dot">.</span></h1><p class="adm-auth__text">No se pudo cargar la librería del panel. Recarga la página.</p>');
  }
  // Enlace de "olvidé mi contraseña": Supabase abre esta página con type=recovery.
  const recovering = /type=recovery/.test(location.hash);
  api.onAuthChange((event) => {
    if (event === 'PASSWORD_RECOVERY') renderRecovery();
    if (event === 'SIGNED_OUT' && state.user) { state.user = null; state.loaded = false; renderLogin('Tu sesión terminó. Inicia sesión de nuevo.'); }
  });
  if (recovering) return; // onAuthChange mostrará el formulario de contraseña nueva.
  try { await start(); } catch (err) { renderLogin(api.friendlyError(err)); }
}

boot();
