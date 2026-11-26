/**
 * Producción: resumen por campaña, matriz producto × color × talla, materiales estimados, pedidos para fabricar
 * (sin datos personales), cambio de estado masivo, checklist por pedido y exportación CSV.
 * Disponible para owner/admin y para el rol «production».
 */
import { db } from './api.js';
import { bindDesignFiles } from './orders.js';
import { rpc, run, errText, esc, toast, dateOnly, loading, errorBox, head, kpi, setBusy, downloadCsv, pill, FULFILLMENT, FINANCIAL, KIND } from './ops.js';

const CHECK = [['cut', 'Corte'], ['print', 'Estampado / bordado'], ['sewing', 'Confección'], ['qc', 'Control de calidad'], ['label', 'Etiquetado'], ['pack', 'Empaque'], ['guide', 'Guía generada']];
const st = { campaign: '', status: '', selected: new Set() };

export async function renderProduction(view) {
  const qp = new URLSearchParams(location.hash.split('?')[1] ?? '');
  if (qp.get('c')) st.campaign = qp.get('c');
  loading(view, 'Cargando producción');
  try {
    const [{ data: camps }, sum, orders] = await Promise.all([
      run(db().from('preorder_campaigns').select('id,name,status,est_dispatch_date').neq('status', 'archived').order('created_at', { ascending: false })),
      rpc('admin_production', { p_campaign: st.campaign || null }),
      rpc('admin_production_orders', { p_campaign: st.campaign || null, p_status: st.status || null }),
    ]);
    // Diseños vigentes de KOVA CUSTOM (la línea del pedido es la posición del artículo, desde 1).
    const ids = orders.filter((o) => o.items.some((i) => i.custom)).map((o) => o.id);
    const designs = ids.length ? (await run(db().from('order_design_files').select('order_id,line_no,face,file_name,path')
      .in('order_id', ids).eq('status', 'active')).catch(() => ({ data: [] }))).data ?? [] : [];
    draw(view, camps, sum, orders, designs);
  } catch (err) { errorBox(view, err, () => renderProduction(view)); }
}

const FACE = { front: 'Frente', back: 'Espalda' };
function designLinks(o, idx, designs) {
  const mine = designs.filter((d) => d.order_id === o.id && d.line_no === idx + 1);
  if (!mine.length) return ' <small class="adm-bad">Diseño pendiente</small>';
  return mine.map((d) => ` <button class="adm-link" type="button" data-design="${esc(d.path)}" data-dl="${esc(d.file_name)}" title="${esc(d.file_name)}">⤓ ${FACE[d.face]}</button>`).join('');
}

function draw(view, camps, s, orders, designs = []) {
  const sizes = [...new Set(s.matrix.map((m) => m.size))];
  const rowsKey = [...new Set(s.matrix.map((m) => `${m.name}|${m.color}`))];
  const cell = (k, size) => s.matrix.filter((m) => `${m.name}|${m.color}` === k && m.size === size).reduce((n, m) => n + m.units, 0);
  view.innerHTML = `
  <div class="adm-wrap adm-wrap--wide">
    ${head('Fabricación', 'Producción', `<button class="btn btn--line btn--sm" type="button" data-csv>Exportar CSV</button>`)}
    <div class="adm-toolbar">
      <label class="adm-select"><span class="sr-only">Campaña</span><select data-camp>
        <option value="">Todas las preventas y KOVA Custom</option>${camps.map((c) => `<option value="${c.id}"${st.campaign === c.id ? ' selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>
      <label class="adm-select"><span class="sr-only">Estado</span><select data-status><option value="">Todos los estados</option>
        ${['confirmed', 'in_production', 'quality_check', 'packed', 'ready', 'shipped', 'delivered'].map((x) => `<option value="${x}"${st.status === x ? ' selected' : ''}>${esc(FULFILLMENT[x])}</option>`).join('')}</select></label>
    </div>
    <dl class="adm-kpis">
      ${kpi('Unidades confirmadas', s.confirmed_units, 'con pago verificado', true)}
      ${kpi('Reservadas sin pagar', s.reserved_units, 'no fabricar todavía')}
      ${kpi('Por producir', s.pending_production)}
      ${kpi('Terminadas', s.finished)}
      ${kpi('Empacadas', s.packed)}
      ${kpi('Entregadas', s.delivered)}
    </dl>

    <section class="adm-card"><h2 class="adm-card__title">Matriz de producción (unidades confirmadas)</h2>
      ${rowsKey.length ? `<div class="adm-table-wrap"><table class="adm-table adm-matrix"><thead><tr><th>Producto</th><th>Color</th>${sizes.map((z) => `<th class="num">${esc(z || 'Única')}</th>`).join('')}<th class="num">Total</th></tr></thead>
        <tbody>${rowsKey.map((k) => { const [n, c] = k.split('|'); const tot = sizes.reduce((a, z) => a + cell(k, z), 0); return `<tr><td>${esc(n)}</td><td>${esc(c || '—')}</td>${sizes.map((z) => `<td class="num">${cell(k, z) || ''}</td>`).join('')}<td class="num adm-strong">${tot}</td></tr>`; }).join('')}</tbody>
        <tfoot><tr><td colspan="2">Total por talla</td>${sizes.map((z) => `<td class="num">${s.matrix.filter((m) => m.size === z).reduce((a, m) => a + m.units, 0)}</td>`).join('')}<td class="num">${s.confirmed_units}</td></tr></tfoot></table></div>`
      : '<p class="adm-muted">Aún no hay unidades confirmadas para fabricar.</p>'}
    </section>

    <section class="adm-card"><h2 class="adm-card__title">Materiales estimados</h2>
      ${s.materials.length ? `<table class="adm-table"><thead><tr><th>Material</th><th class="num">Cantidad</th><th>Unidad</th></tr></thead><tbody>${s.materials.map((m) => `<tr><td>${esc(m.material)}</td><td class="num">${m.qty}</td><td>${esc(m.unit ?? '')}</td></tr>`).join('')}</tbody></table>` : ''}
      ${s.products_without_materials.length ? `<p class="adm-muted">Sin materiales registrados: ${esc(s.products_without_materials.join(', '))}. Agrégalos en Inventario → Costos y materiales.</p>` : ''}
      ${!s.materials.length && !s.products_without_materials.length ? '<p class="adm-muted">Sin datos.</p>' : ''}
    </section>

    <section class="adm-card"><div class="adm-card__head"><h2 class="adm-card__title">Pedidos a fabricar (${orders.length})</h2>
      <div class="adm-bulk" data-bulk hidden><span data-n></span>
        <select class="field__input" data-to>${['in_production', 'quality_check', 'packed', 'ready', 'shipped', 'delivered'].map((x) => `<option value="${x}">${esc(FULFILLMENT[x])}</option>`).join('')}</select>
        <button class="btn btn--primary btn--sm" type="button" data-apply>Cambiar estado</button></div></div>
      ${orders.length ? `<div class="adm-table-wrap"><table class="adm-table"><thead><tr><th><input type="checkbox" data-all aria-label="Seleccionar todos"></th><th>Pedido</th><th>Artículos</th><th>Ciudad</th><th>Estado</th><th>Despacho</th><th>Checklist</th></tr></thead>
        <tbody>${orders.map((o) => { const done = CHECK.filter(([k]) => o.checklist?.[k]).length; return `<tr>
          <td><input type="checkbox" data-sel="${o.id}"${st.selected.has(o.id) ? ' checked' : ''} aria-label="Seleccionar ${esc(o.number)}"></td>
          <td class="adm-strong">${esc(o.number)}<small>${esc(KIND[o.kind] ?? '')}${o.balance_due ? ' · <b>saldo pendiente</b>' : ''}</small></td>
          <td>${o.items.map((i, idx) => `<div>${i.qty} × ${esc(i.name)} <small>${esc([i.color, i.size, i.custom?.mode_label].filter(Boolean).join(' · '))}</small>${i.custom ? designLinks(o, idx, designs) : ''}</div>`).join('')}</td>
          <td>${esc(o.city)}</td><td>${pill(o.fulfillment_status, FULFILLMENT)}${o.balance_due ? `<small>${esc(FINANCIAL[o.financial_status])}</small>` : ''}</td>
          <td>${o.est_dispatch_date ? esc(dateOnly(o.est_dispatch_date)) : '—'}</td>
          <td><details class="adm-ck"><summary>${done}/${CHECK.length}</summary>${CHECK.map(([k, l]) => `<label class="adm-check"><input type="checkbox" data-ck="${o.id}" data-k="${k}"${o.checklist?.[k] ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</details></td>
        </tr>`; }).join('')}</tbody></table></div>` : '<p class="adm-muted">No hay pedidos confirmados con estos filtros.</p>'}
    </section>
  </div>`;

  bindDesignFiles(view);
  view.querySelector('[data-camp]').addEventListener('change', (e) => { st.campaign = e.target.value; st.selected.clear(); history.replaceState(null, '', '#/produccion'); renderProduction(view); });
  view.querySelector('[data-status]').addEventListener('change', (e) => { st.status = e.target.value; renderProduction(view); });
  const bulk = view.querySelector('[data-bulk]');
  const sync = () => { bulk.hidden = !st.selected.size; bulk.querySelector('[data-n]').textContent = `${st.selected.size} seleccionado(s)`; };
  view.querySelectorAll('[data-sel]').forEach((c) => c.addEventListener('change', () => { if (c.checked) st.selected.add(c.dataset.sel); else st.selected.delete(c.dataset.sel); sync(); }));
  view.querySelector('[data-all]')?.addEventListener('change', (e) => { view.querySelectorAll('[data-sel]').forEach((c) => { c.checked = e.target.checked; if (c.checked) st.selected.add(c.dataset.sel); else st.selected.delete(c.dataset.sel); }); sync(); });
  sync();
  bulk.querySelector('[data-apply]').addEventListener('click', async (e) => {
    const done = setBusy(e.currentTarget, 'Aplicando…');
    try {
      const r = await rpc('admin_set_fulfillment', { p_orders: [...st.selected], p_status: bulk.querySelector('[data-to]').value, p_note: '' });
      toast(`${r.updated} actualizado(s).${r.skipped.length ? ` Sin cambio: ${r.skipped.map((x) => `${x.number} (${x.reason})`).join('; ')}` : ''}`);
      st.selected.clear(); renderProduction(view);
    } catch (err) { done(); toast(errText(err)); }
  });
  view.querySelectorAll('[data-ck]').forEach((c) => c.addEventListener('change', async () => {
    const id = c.dataset.ck;
    const ck = Object.fromEntries([...view.querySelectorAll(`[data-ck="${id}"]`)].map((x) => [x.dataset.k, x.checked]));
    try { await rpc('admin_update_order', { p_order: id, p: { production_checklist: ck } }); c.closest('details').querySelector('summary').textContent = `${Object.values(ck).filter(Boolean).length}/${CHECK.length}`; } catch (err) { c.checked = !c.checked; toast(errText(err)); }
  }));
  view.querySelector('[data-csv]').addEventListener('click', () => {
    const lines = orders.flatMap((o) => o.items.map((i) => ({ ...i, number: o.number, status: FULFILLMENT[o.fulfillment_status], city: o.city, dispatch: o.est_dispatch_date, balance: o.balance_due ? 'Sí' : 'No' })));
    downloadCsv('kova-produccion', [
      { label: 'Pedido', key: 'number' }, { label: 'Producto', key: 'name' }, { label: 'Color', key: 'color' }, { label: 'Talla', key: 'size' }, { label: 'Cantidad', key: 'qty' },
      { label: 'Personalización', get: (i) => (i.custom ? [i.custom.mode_label, i.custom.zones?.join?.(', '), i.custom.notes].filter(Boolean).join(' · ') : '') },
      { label: 'Estado', key: 'status' }, { label: 'Ciudad', key: 'city' }, { label: 'Despacho estimado', key: 'dispatch' }, { label: 'Saldo pendiente', key: 'balance' },
    ], lines);
  });
}
