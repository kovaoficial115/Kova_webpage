/**
 * Inventario: modalidad de venta de cada producto, existencias por talla × color (opcional), costos y materiales.
 * Existencias vacías = sin control de inventario (se vende sin límite de stock).
 * Reservadas = unidades apartadas por pedidos pendientes de pago (las mueve el servidor, no se editan aquí).
 */
import { db } from './api.js';
import { run, errText, esc, toast, money, loading, errorBox, head, setBusy, intOrNull, downloadCsv } from './ops.js';

export const SALE_MODES = { normal: 'Venta normal', preorder: 'Preventa', coming_soon: 'Próximamente', sold_out: 'Agotado', hidden: 'Oculto' };

export async function renderInventoryOps(view) {
  loading(view, 'Cargando inventario');
  try {
    const [{ data: products }, { data: variants }, { data: costs }] = await Promise.all([
      run(db().from('products').select('id,name,price,sale_mode,published').order('position')),
      run(db().from('product_variants').select('*').eq('active', true).order('product_id').order('color').order('size')),
      run(db().from('product_costs').select('*')),
    ]);
    draw(view, products, variants, costs);
  } catch (err) { errorBox(view, err, () => renderInventoryOps(view)); }
}

const matRow = (m = {}) => `<div class="adm-mat" data-mat>
  <input class="field__input" data-m="name" placeholder="Material (ej. Tela algodón)" value="${esc(m.name ?? '')}" maxlength="60" aria-label="Material">
  <input class="field__input" data-m="qty" placeholder="Cantidad" inputmode="decimal" value="${esc(m.qty ?? '')}" aria-label="Cantidad por unidad">
  <input class="field__input" data-m="unit" placeholder="Unidad (m, g, und)" value="${esc(m.unit ?? '')}" maxlength="12" aria-label="Unidad">
  <button class="adm-iconbtn adm-iconbtn--danger" type="button" data-mat-del aria-label="Quitar material">×</button></div>`;

function draw(view, products, variants, costs) {
  view.innerHTML = `
  <div class="adm-wrap adm-wrap--wide">
    ${head('Catálogo', 'Inventario', '<button class="btn btn--line btn--sm" type="button" data-csv>Exportar CSV</button>')}
    <p class="adm-muted">Existencias vacías = sin control de stock. «Reservadas» son unidades apartadas por pedidos pendientes de pago. Los costos son privados (solo administradores) y alimentan la protección de rentabilidad.</p>
    ${products.map((p) => {
      const vs = variants.filter((v) => v.product_id === p.id);
      const c = costs.find((x) => x.product_id === p.id) ?? { unit_cost: null, materials: [] };
      return `
      <section class="adm-card" data-prod="${esc(p.id)}">
        <div class="adm-card__head"><h2 class="adm-card__title">${esc(p.name)} <small class="adm-muted">${money(p.price)}</small></h2>
          <label class="adm-select"><span class="sr-only">Modalidad de venta</span><select data-mode>${Object.entries(SALE_MODES).map(([k, l]) => `<option value="${k}"${p.sale_mode === k ? ' selected' : ''}>${l}</option>`).join('')}</select></label></div>
        <div class="adm-table-wrap"><table class="adm-table"><thead><tr><th>Color</th><th>Talla</th><th>SKU</th><th class="num">Existencias</th><th class="num">Reservadas</th><th class="num">Disponibles</th><th class="num">Costo variante</th></tr></thead>
          <tbody>${vs.map((v) => `<tr data-var="${v.id}"><td>${esc(v.color || '—')}</td><td>${esc(v.size || 'Única')}</td>
            <td><input class="field__input adm-in-sm" data-f="sku" value="${esc(v.sku ?? '')}" maxlength="40" aria-label="SKU"></td>
            <td class="num"><input class="field__input adm-in-sm" data-f="stock_on_hand" inputmode="numeric" placeholder="∞" value="${v.stock_on_hand ?? ''}" aria-label="Existencias"></td>
            <td class="num">${v.stock_reserved}</td>
            <td class="num">${v.stock_on_hand == null ? '∞' : Math.max(v.stock_on_hand - v.stock_reserved, 0)}${v.stock_on_hand != null && v.stock_on_hand - v.stock_reserved <= 2 ? ' <span class="adm-st adm-st--warn">bajo</span>' : ''}</td>
            <td class="num"><input class="field__input adm-in-sm" data-f="cost" inputmode="numeric" placeholder="—" value="${v.cost ?? ''}" aria-label="Costo de la variante"></td></tr>`).join('')}</tbody></table></div>
        <details class="adm-costs"${c.unit_cost != null || c.materials.length ? ' open' : ''}><summary>Costos y materiales por unidad</summary>
          <label class="field adm-in-md"><span class="field__label">Costo de producción por unidad (COP)</span><input class="field__input" data-unit-cost inputmode="numeric" value="${c.unit_cost ?? ''}"></label>
          ${c.unit_cost != null ? `<p class="adm-muted">Margen a precio completo: <b>${Math.round(((p.price - c.unit_cost) / p.price) * 1000) / 10}%</b> (${money(p.price - c.unit_cost)} por unidad).</p>` : ''}
          <div data-mats>${(c.materials ?? []).map(matRow).join('')}</div>
          <button class="adm-link" type="button" data-mat-add>+ Agregar material</button>
        </details>
        <div class="adm-card__foot"><button class="btn btn--primary btn--sm" type="button" data-save>Guardar ${esc(p.name)}</button></div>
      </section>`;
    }).join('')}
  </div>`;

  view.querySelectorAll('[data-mat-add]').forEach((b) => b.addEventListener('click', () => b.previousElementSibling.insertAdjacentHTML('beforeend', matRow())));
  view.addEventListener('click', (e) => { if (e.target.matches('[data-mat-del]')) e.target.closest('[data-mat]').remove(); });
  view.querySelectorAll('[data-prod]').forEach((sec) => {
    const pid = sec.dataset.prod;
    const p = products.find((x) => x.id === pid);
    sec.querySelector('[data-mode]').addEventListener('change', async (e) => {
      const mode = e.target.value;
      if (mode === 'preorder') toast('Recuerda incluir el producto en una campaña activa de Preventas; si no, no se podrá reservar.');
      try {
        const { data } = await run(db().from('products').update({ sale_mode: mode }).eq('id', pid).select('id'));
        if (!data.length) throw new Error('permission denied');
        p.sale_mode = mode; toast(`${p.name}: ${SALE_MODES[mode]}.`);
      } catch (err) { e.target.value = p.sale_mode; toast(errText(err)); }
    });
    sec.querySelector('[data-save]').addEventListener('click', async (e) => {
      const done = setBusy(e.currentTarget, 'Guardando…');
      try {
        const rows = [...sec.querySelectorAll('[data-var]')].map((tr) => {
          const g = (f) => tr.querySelector(`[data-f="${f}"]`).value.trim();
          return { id: tr.dataset.var, sku: g('sku') || null, stock_on_hand: intOrNull(g('stock_on_hand')), cost: intOrNull(g('cost')) };
        });
        const orig = variants.filter((v) => v.product_id === pid);
        for (const r of rows) {
          const o = orig.find((v) => v.id === r.id);
          if (o.sku === r.sku && o.stock_on_hand === r.stock_on_hand && o.cost === r.cost) continue;
          if (r.stock_on_hand != null && r.stock_on_hand < o.stock_reserved) throw new Error(`KOVA:Las existencias de ${o.color} ${o.size} no pueden ser menores que las reservadas (${o.stock_reserved}).`);
          const { data } = await run(db().from('product_variants').update({ sku: r.sku, stock_on_hand: r.stock_on_hand, cost: r.cost }).eq('id', r.id).select('id'));
          if (!data.length) throw new Error('permission denied');
        }
        const mats = [...sec.querySelectorAll('[data-mat]')].map((m) => ({ name: m.querySelector('[data-m="name"]').value.trim(), qty: Number(m.querySelector('[data-m="qty"]').value.replace(',', '.')) || 0, unit: m.querySelector('[data-m="unit"]').value.trim() })).filter((m) => m.name);
        await run(db().from('product_costs').upsert({ product_id: pid, unit_cost: intOrNull(sec.querySelector('[data-unit-cost]').value), materials: mats }, { onConflict: 'product_id' }));
        toast(`${p.name} guardado.`);
        renderInventoryOps(view);
      } catch (err) { done(); toast(/sku|duplicate/.test(String(err?.message)) ? 'Ese SKU ya existe en otra variante.' : errText(err)); }
    });
  });
  view.querySelector('[data-csv]').addEventListener('click', () => downloadCsv('kova-inventario', [
    { label: 'Producto', get: (v) => products.find((p) => p.id === v.product_id)?.name }, { label: 'Modalidad', get: (v) => SALE_MODES[products.find((p) => p.id === v.product_id)?.sale_mode] },
    { label: 'Color', key: 'color' }, { label: 'Talla', key: 'size' }, { label: 'SKU', key: 'sku' }, { label: 'Existencias', key: 'stock_on_hand' },
    { label: 'Reservadas', key: 'stock_reserved' }, { label: 'Costo variante', key: 'cost' },
    { label: 'Costo unitario producto', get: (v) => costs.find((c) => c.product_id === v.product_id)?.unit_cost },
  ], variants));
}
