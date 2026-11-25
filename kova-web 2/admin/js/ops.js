/**
 * Utilidades compartidas por las secciones operativas del panel (pedidos, preventas, códigos, estadísticas…).
 * Todo cálculo de dinero, cupos y estados lo hace el servidor (funciones admin_* de Supabase).
 */
import { db, friendlyError } from './api.js';
import { formatPrice } from '../../js/utils/format.js';
import { esc, toast } from '../../js/utils/dom.js';

export { esc, toast, formatPrice as money };
export const TZ = 'America/Bogota';

/** Llama una función del servidor y lanza el error si lo hay. */
export async function rpc(fn, args = {}) {
  const { data, error } = await db().rpc(fn, args);
  if (error) throw error;
  return data;
}
/** Ejecuta una consulta de supabase-js y devuelve { data, count }. */
export async function run(builder) {
  const { data, error, count } = await builder;
  if (error) throw error;
  return { data, count };
}
export const errText = (err) => {
  const m = String(err?.message ?? err ?? '');
  return m.startsWith('KOVA:') ? m.slice(5) : friendlyError(err);
};

/* ---------- Rol del usuario ---------- */
let role = null;
export async function loadRole() {
  try { role = (await rpc('admin_role')) || 'owner'; } catch { role = 'owner'; }
  return role;
}
export const getRole = () => role;
export const isAdminRole = () => role === 'owner' || role === 'admin';

/* ---------- Fechas (siempre hora de Colombia) ---------- */
export const dt = (iso) => (iso ? new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: TZ }) : '—');
export const dShort = (iso) => (iso ? new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', timeZone: TZ }) : '—');
export const dateOnly = (ymd) => (ymd ? new Date(`${ymd}T12:00:00-05:00`).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : '—');
/** timestamptz → valor de <input type="datetime-local"> en hora de Colombia. */
export function toLocalInput(iso) {
  if (!iso) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}`;
}
/** <input type="datetime-local"> (hora de Colombia, UTC−5 sin horario de verano) → ISO. */
export const fromLocalInput = (v) => (v ? new Date(`${v}:00-05:00`).toISOString() : null);
export const todayYmd = () => new Date().toLocaleDateString('en-CA', { timeZone: TZ });
export const daysAgoIso = (n) => new Date(Date.now() - n * 864e5).toISOString();

/* ---------- Estados ---------- */
export { FINANCIAL, FULFILLMENT, FULFILLMENT_NEXT, KIND, PAYMENT_KIND, PAYMENT_STATUS, tone } from '../../js/data/orderStatus.js';
import { tone } from '../../js/data/orderStatus.js';
const ICON = { ok: '✓', warn: '!', bad: '×', info: '•', muted: '–' };
export const pill = (s, map) => { const t = tone(s); return `<span class="adm-st adm-st--${t}"><span aria-hidden="true">${ICON[t] ?? '•'}</span>${esc(map[s] ?? s ?? '—')}</span>`; };

/* ---------- Vistas ---------- */
export const loading = (view, text = 'Cargando…') => {
  view.innerHTML = `<div class="adm-wrap"><div class="adm-skel" aria-busy="true" aria-label="${esc(text)}"><div></div><div></div><div></div></div></div>`;
};
export function errorBox(view, err, retry) {
  view.innerHTML = `<div class="adm-wrap"><div class="adm-alert"><b>No se pudo cargar esta sección.</b><p>${esc(errText(err))}</p>
    ${/does not exist|PGRST202|schema cache/i.test(String(err?.message)) ? '<p>Parece que faltan las migraciones de la base de datos (supabase/migrations). Ver README.</p>' : ''}
    <button class="btn btn--primary btn--sm" type="button" data-retry>Reintentar</button></div></div>`;
  view.querySelector('[data-retry]').addEventListener('click', retry);
}
export const head = (eyebrow, title, actions = '') => `
  <div class="adm-head"><div><p class="eyebrow">${esc(eyebrow)}</p><h1 class="adm-head__title">${esc(title)}<span class="dot">.</span></h1></div>
  ${actions ? `<div class="adm-head__actions">${actions}</div>` : ''}</div>`;
export const kpi = (label, value, note = '', strong = false) => `
  <div class="adm-kpi${strong ? ' adm-kpi--strong' : ''}"><dt>${esc(label)}</dt><dd>${value}</dd>${note ? `<p>${note}</p>` : ''}</div>`;
export function setBusy(button, text) {
  if (!button) return () => {};
  const prev = button.innerHTML;
  button.disabled = true;
  button.innerHTML = `<span class="adm-spin" aria-hidden="true"></span> ${esc(text)}`;
  return () => { button.disabled = false; button.innerHTML = prev; };
}

/** Diálogo con formulario; devuelve los valores o null si se cancela. */
export function formDialog({ title, body, confirm = 'Guardar', danger = false, validate = null }) {
  const dialog = document.getElementById('dialog');
  return new Promise((resolve) => {
    dialog.innerHTML = `
      <form method="dialog" class="adm-dialog__box" novalidate>
        <h2 class="adm-dialog__title">${esc(title)}<span class="dot">.</span></h2>
        <div class="adm-dialog__body">${body}</div>
        <p class="adm-form-msg" data-dmsg role="alert"></p>
        <div class="adm-dialog__actions">
          <button class="btn btn--line btn--sm" value="cancel" formnovalidate>Cancelar</button>
          <button class="btn ${danger ? 'btn--danger' : 'btn--primary'} btn--sm" value="ok">${esc(confirm)}</button>
        </div>
      </form>`;
    const form = dialog.querySelector('form');
    let values = null;
    form.addEventListener('submit', (e) => {
      if (e.submitter?.value !== 'ok') return;
      const fd = new FormData(form);
      const v = Object.fromEntries(fd.entries());
      form.querySelectorAll('input[type="checkbox"]').forEach((c) => { v[c.name] = c.checked; });
      const msg = validate?.(v);
      if (msg) { e.preventDefault(); form.querySelector('[data-dmsg]').textContent = msg; return; }
      values = v;
    });
    dialog.addEventListener('close', () => resolve(dialog.returnValue === 'ok' ? values : null), { once: true });
    dialog.returnValue = '';
    dialog.showModal();
    (form.querySelector('input:not([type=hidden]), select, textarea') ?? form.querySelector('[value="cancel"]')).focus();
  });
}
export const fld = (name, label, { type = 'text', value = '', req = false, hint = '', attrs = '' } = {}) => `
  <label class="field"><span class="field__label">${esc(label)}${req ? ' <span>*</span>' : ''}</span>
    ${type === 'textarea' ? `<textarea class="field__input" name="${name}" rows="3" ${attrs}>${esc(value)}</textarea>`
      : `<input class="field__input" name="${name}" type="${type}" value="${esc(value)}"${req ? ' required' : ''} ${attrs}>`}
    ${hint ? `<span class="field__hint">${hint}</span>` : ''}</label>`;
export const intOrNull = (v) => { const s = String(v ?? '').replace(/[^\d-]/g, ''); return s === '' ? null : Number(s); };

/* ---------- Exportar ---------- */
const cell = (v) => {
  const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;          // evita fórmulas al abrir en Excel
  return /[",;\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};
/** CSV con BOM (Excel en español lo abre con tildes y columnas correctas). */
export function downloadCsv(name, columns, rows) {
  const lines = [columns.map((c) => cell(c.label)).join(';'), ...rows.map((r) => columns.map((c) => cell(typeof c.get === 'function' ? c.get(r) : r[c.key])).join(';'))];
  const blob = new Blob([`﻿${lines.join('\r\n')}`], { type: 'text/csv;charset=utf-8' });
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: `${name}-${todayYmd()}.csv` });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/* ---------- Gráficas (SVG, accesibles, con tabla y descripción) ----------
 * Paleta validada sobre fondo blanco: serie 1 #3B4CC0, serie 2 #D21625 (escarlata de marca). */
export const SERIES = ['#3B4CC0', '#D21625'];
const fmtAxis = (n, isMoney) => (isMoney ? (n >= 1e6 ? `$${(n / 1e6).toFixed(n % 1e6 ? 1 : 0)} M` : n >= 1e3 ? `$${Math.round(n / 1e3)} mil` : `$${n}`) : String(n));
const niceMax = (v) => { if (v <= 0) return 1; if (v <= 2) return 2; const p = 10 ** Math.floor(Math.log10(v)); const m = v / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 5 ? 5 : 10) * p; };

/**
 * Barras verticales por periodo (una o dos series lado a lado).
 * data: [{ label, values: [n, n?] }], series: ['nombre1', 'nombre2'?]
 */
export function barChart({ id, title, data, series, money = false, empty = 'Sin datos en este periodo.' }) {
  if (!data.length || data.every((d) => d.values.every((v) => !v))) return `<figure class="adm-chart"><figcaption>${esc(title)}</figcaption><p class="adm-chart__empty">${esc(empty)}</p></figure>`;
  const W = 640; const H = 220; const L = 56; const B = 26; const T = 10;
  const max = niceMax(Math.max(...data.flatMap((d) => d.values)));
  const n = data.length; const groupW = (W - L) / n; const k = series.length;
  const barW = Math.max(3, Math.min(28, (groupW - 6) / k - 2));
  const y = (v) => T + (H - T - B) * (1 - v / max);
  const ticks = money || Number.isInteger(max / 2) ? [0, max / 2, max] : [0, max];
  const every = Math.ceil(n / 8);
  const bars = data.map((d, i) => d.values.map((v, s) => {
    const x = L + i * groupW + (groupW - (barW + 2) * k) / 2 + s * (barW + 2);
    const h = Math.max(v ? 2 : 0, H - B - y(v));
    return `<rect class="adm-chart__bar" x="${x.toFixed(1)}" y="${(H - B - h).toFixed(1)}" width="${barW.toFixed(1)}" height="${h.toFixed(1)}" rx="2" fill="${SERIES[s]}"
      tabindex="0" data-tip="${esc(`${d.label} · ${series[s]}: ${money ? formatPrice(v) : v}`)}"><title>${esc(`${d.label} · ${series[s]}: ${money ? formatPrice(v) : v}`)}</title></rect>`;
  }).join('')).join('');
  return `
  <figure class="adm-chart" id="${id}">
    <figcaption>${esc(title)}</figcaption>
    ${k > 1 ? `<ul class="adm-legend">${series.map((s, i) => `<li><span style="background:${SERIES[i]}"></span>${esc(s)}</li>`).join('')}</ul>` : ''}
    <div class="adm-chart__plot">
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}" preserveAspectRatio="none">
        ${ticks.map((t) => `<line class="adm-chart__grid" x1="${L}" x2="${W}" y1="${y(t)}" y2="${y(t)}"/><text class="adm-chart__ax" x="${L - 6}" y="${y(t) + 4}" text-anchor="end">${fmtAxis(t, money)}</text>`).join('')}
        ${bars}
        ${data.map((d, i) => (i % every === 0 ? `<text class="adm-chart__ax" x="${L + i * groupW + groupW / 2}" y="${H - 6}" text-anchor="middle">${esc(d.label)}</text>` : '')).join('')}
      </svg>
      <div class="adm-chart__tip" hidden></div>
    </div>
    <details class="adm-chart__table"><summary>Ver tabla</summary>
      <table class="adm-table"><thead><tr><th>Periodo</th>${series.map((s) => `<th class="num">${esc(s)}</th>`).join('')}</tr></thead>
      <tbody>${data.map((d) => `<tr><td>${esc(d.label)}</td>${d.values.map((v) => `<td class="num">${money ? formatPrice(v) : v}</td>`).join('')}</tr>`).join('')}</tbody></table>
    </details>
  </figure>`;
}

/** Barras horizontales (ranking): [{ label, value, note? }] */
export function rankChart({ title, data, money = false, empty = 'Sin datos todavía.', max = 8 }) {
  const list = data.slice(0, max);
  if (!list.length) return `<figure class="adm-chart"><figcaption>${esc(title)}</figcaption><p class="adm-chart__empty">${esc(empty)}</p></figure>`;
  const top = Math.max(...list.map((d) => d.value), 1);
  return `
  <figure class="adm-chart"><figcaption>${esc(title)}</figcaption>
    <ol class="adm-rank">${list.map((d) => `
      <li><span class="adm-rank__label">${esc(d.label ?? 'Sin dato')}</span>
        <span class="adm-rank__bar"><span style="width:${Math.max(2, (d.value / top) * 100).toFixed(1)}%"></span></span>
        <b class="adm-rank__val">${money ? formatPrice(d.value) : d.value}${d.note ? ` <small>${esc(d.note)}</small>` : ''}</b></li>`).join('')}</ol>
  </figure>`;
}

/** Activa los tooltips de las barras dentro de root. */
export function bindCharts(root) {
  root.querySelectorAll('.adm-chart__plot').forEach((plot) => {
    const tip = plot.querySelector('.adm-chart__tip');
    const show = (e) => {
      const r = e.target.closest('[data-tip]'); if (!r) return;
      tip.textContent = r.dataset.tip; tip.hidden = false;
      const box = plot.getBoundingClientRect(); const b = r.getBoundingClientRect();
      tip.style.left = `${Math.min(Math.max(b.left - box.left + b.width / 2, 60), box.width - 60)}px`;
      tip.style.top = `${b.top - box.top}px`;
    };
    plot.addEventListener('pointerover', show); plot.addEventListener('focusin', show);
    plot.addEventListener('pointerleave', () => { tip.hidden = true; }); plot.addEventListener('focusout', () => { tip.hidden = true; });
  });
}

/** Paginador simple. */
export const pager = (page, pages, total) => (pages <= 1 ? `<p class="adm-pager__info">${total} resultado(s)</p>` : `
  <nav class="adm-pager" aria-label="Paginación">
    <button class="btn btn--line btn--sm" type="button" data-page="${page - 1}"${page <= 1 ? ' disabled' : ''}>← Anterior</button>
    <span>Página ${page} de ${pages} · ${total} resultados</span>
    <button class="btn btn--line btn--sm" type="button" data-page="${page + 1}"${page >= pages ? ' disabled' : ''}>Siguiente →</button>
  </nav>`);

export const waLink = (phone, text) => `https://wa.me/${String(phone).replace(/\D/g, '')}?text=${encodeURIComponent(text)}`;
export const copy = async (text) => { try { await navigator.clipboard.writeText(text); toast('Copiado.'); } catch { toast('No se pudo copiar.'); } };
