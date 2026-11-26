/**
 * Prueba del panel /admin en Chrome contra el simulador local (después de tienda.mjs, que deja un pedido con comprobante).
 */
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
const require = createRequire('/opt/node-tools/node_modules/');
const { chromium } = require('playwright');

const SITE = 'http://localhost:8080';
const SHOTS = process.env.SHOTS || '/tmp/e2e-shots';
const results = [];
const ok = (cond, msg) => { results.push([Boolean(cond), msg]); console.log(`${cond ? 'ok  ' : 'FALLA'} ${msg}`); };

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
async function newPage(viewport) {
  const ctx = await browser.newContext({ viewport, locale: 'es-CO', timezoneId: 'America/Bogota' });
  await ctx.route(/vfdpkmqncbhrauqtrnay\.supabase\.co/, async (route) => {
    const req = route.request(); const u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const res = await fetch(`http://localhost:54321${u.pathname}${u.search}`, { method: req.method(), headers: req.headers(), body: req.postDataBuffer() ?? undefined });
    route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource|favicon/.test(m.text())) page.errors.push(m.text()); });
  page.on('dialog', (d) => d.dismiss());
  return page;
}
const text = (page) => page.textContent('[data-view]');
const waitView = (page, sel) => page.waitForSelector(`[data-view] ${sel}`, { timeout: 10000 });
async function tab(page, name, title) {
  await page.click(`.adm-tabs a[data-tab="${name}"]`);
  await page.waitForFunction((t) => document.querySelector('[data-view] .adm-head__title')?.textContent.startsWith(t), title, { timeout: 10000 });
}
async function login(page, email) {
  await page.goto(`${SITE}/admin/index.html`);
  await page.fill('[name="email"]', email);
  await page.fill('[name="password"]', 'kova-test');
  await page.click('[data-login] [type="submit"]');
  await page.waitForSelector('.adm-shell', { timeout: 10000 });
}
async function dialogFill(page, fields = {}) {
  await page.waitForSelector('#dialog[open]');
  for (const [k, v] of Object.entries(fields)) await page.fill(`#dialog [name="${k}"]`, String(v));
  await page.click('#dialog [value="ok"]');
}

const page = await newPage({ width: 1366, height: 900 });
await login(page, 'owner@test');

// Dashboard
await waitView(page, '.adm-kpis');
let t = await text(page);
ok(/Ventas comprometidas/.test(t) && /Dinero recaudado/.test(t), 'dashboard separa ventas comprometidas y dinero recaudado');
ok(/comprobante\(s\) por revisar/.test(t), 'dashboard avisa comprobantes por revisar');
await page.screenshot({ path: `${SHOTS}/10-admin-dashboard.png`, fullPage: true });

// Pedidos
await tab(page, 'pedidos', 'Pedidos');
await waitView(page, '.adm-orders');
t = await text(page);
ok(/KOVA-PSY-000001/.test(t), 'pedidos: aparece el pedido de la tienda');
await page.fill('[data-f="q"]', 'cliente@prueba');
await page.waitForTimeout(900);
ok(/KOVA-PSY-000001/.test(await text(page)), 'pedidos: búsqueda por correo');
await page.selectOption('[data-f="ful"]', 'delivered');
await page.waitForTimeout(600);
ok(/No hay pedidos con estos filtros/.test(await text(page)), 'pedidos: filtro por estado');
await page.click('[data-clear]');
await waitView(page, '.adm-orders');
await page.screenshot({ path: `${SHOTS}/11-admin-pedidos.png`, fullPage: true });
await page.click('a.adm-strong >> text=KOVA-PSY-000001');
await waitView(page, '.adm-detail');
t = await text(page);
ok(/Cliente Prueba/.test(t) && /Por revisar/.test(t), 'detalle: cliente y comprobante por revisar');
ok(await page.$('[data-proof]'), 'detalle: botón para ver el comprobante privado');
const [popup] = await Promise.all([page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null), page.click('[data-proof]')]);
await popup?.waitForURL(/payment-proofs/, { timeout: 5000 }).catch(() => {});

ok(popup && /\/storage\/v1\/object\/sign\/payment-proofs\//.test(popup.url()), 'detalle: el comprobante se abre con URL firmada temporal');
await popup?.close();
await page.click('[data-review="approve"]');
await dialogFill(page);
await page.waitForFunction(() => /Anticipo confirmado/.test(document.querySelector('[data-view]').textContent), null, { timeout: 10000 });
t = await text(page);
ok(/Reserva confirmada/.test(t), 'detalle: aprobar el anticipo confirma la reserva');
ok(/\$\s?64\.800/.test(t), 'detalle: saldo pendiente $64.800');
await page.click('[data-ful="in_production"]');
await page.waitForFunction(() => /En producción/.test(document.querySelector('.adm-status-row')?.textContent ?? ''), null, { timeout: 10000 });
ok(true, 'detalle: cambio de estado a En producción');
await page.fill('[data-note] [name="note"]', 'Cliente pidió empaque de regalo');
await page.click('[data-note] button');
await page.waitForFunction(() => /empaque de regalo/.test(document.querySelector('.adm-history')?.textContent ?? ''), null, { timeout: 10000 });
ok(true, 'detalle: nota interna en el historial');
await page.click('[data-ck="cut"]');
await page.waitForTimeout(600);
await page.screenshot({ path: `${SHOTS}/12-admin-pedido.png`, fullPage: true });

// Preventas
await tab(page, 'preventas', 'Preventas');
await waitView(page, '.adm-camp');
t = await text(page);
ok(/PSYCHE_01/.test(t) && /Abierta/.test(t), 'preventas: campaña abierta con cupo usado');
await page.screenshot({ path: `${SHOTS}/13-admin-preventas.png`, fullPage: true });
await page.click('.adm-camp__name a');
await waitView(page, '[data-camp]');
await page.fill('[name="max_per_customer"]', '2');
await page.click('[data-save]');
await page.waitForFunction(() => document.querySelector('.toast, [role="status"]')?.textContent?.includes('guardada') || /Campaña guardada/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => {});
ok(/Campaña guardada/.test(await page.textContent('body')), 'preventas: editar y guardar campaña');
await page.click('.adm-crumb');
await page.click('[data-dup]');
await waitView(page, '[data-camp]');
ok(/copia/.test(await page.inputValue('[name="name"]')), 'preventas: duplicar crea un borrador');
await page.click('.adm-tools [data-status="active"]');
await dialogFill(page);
await page.waitForTimeout(800);
ok(/Antes de activar la campaña configura/.test(await page.textContent('body')), 'preventas: no se activa sin fechas');
// Fecha sin hora: antes se guardaba vacía sin avisar (datetime-local a medio llenar).
await page.fill('[name="opens_at_d"]', '2026-12-01');
await page.click('[data-save]');
await page.waitForTimeout(400);
ok(/la hora de apertura/.test(await page.textContent('[data-msg]')), 'preventas: fecha sin hora avisa en vez de guardarse vacía');
await page.fill('[name="opens_at_t"]', '09:00');
await page.fill('[name="closes_at_d"]', '2026-12-20');
await page.fill('[name="closes_at_t"]', '23:59');
await page.click('[data-save]');
await page.waitForFunction(() => /Campaña guardada/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => {});
await waitView(page, '[data-camp]');
ok(await page.inputValue('[name="opens_at_d"]') === '2026-12-01' && await page.inputValue('[name="opens_at_t"]') === '09:00', 'preventas: apertura guardada con fecha y hora (Bogotá)');
await page.click('.adm-tools [data-status="active"]');
await dialogFill(page);
await page.waitForTimeout(800);
ok(!/fecha y hora de apertura/.test(await page.textContent('body')), 'preventas: con fechas guardadas, activar ya no pide la apertura');
// Modalidad de pago: solo pago completo / solo anticipo / ambos.
await page.goto(page.url()); await waitView(page, '[data-camp]');
await page.check('[name="pay_mode"][value="full"]', { force: true });
ok(await page.isHidden('[data-field="deposit_pct"]'), 'preventas: con "solo pago completo" se oculta el % de anticipo');
await page.click('[data-save]');
await page.waitForFunction(() => /Campaña guardada/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => {});
await waitView(page, '[data-camp]');
ok(await page.isChecked('[name="pay_mode"][value="full"]'), 'preventas: se guarda "solo pago completo"');
await page.check('[name="pay_mode"][value="deposit"]', { force: true });
await page.fill('[name="deposit_pct"]', '40');
await page.click('[data-save]');
await page.waitForFunction(() => /Campaña guardada/.test(document.body.textContent), null, { timeout: 10000 }).catch(() => {});
await waitView(page, '[data-camp]');
ok(await page.isChecked('[name="pay_mode"][value="deposit"]') && await page.inputValue('[name="deposit_pct"]') === '40', 'preventas: se guarda "solo anticipo" del 40%');
await page.waitForTimeout(600);
await page.check('[name="pay_mode"][value="both"]', { force: true });
await page.fill('[name="deposit_pct"]', '100');
await page.click('[data-save]');
await page.waitForTimeout(400);
const m99 = await page.textContent('[data-msg]');
ok(/anticipo entre 1 y 99/.test(m99), 'preventas: "ambos" exige un anticipo menor al 100%');

// Códigos
await tab(page, 'codigos', 'Códigos');
await waitView(page, '.adm-table');
ok(/PRUEBA10/i.test(await text(page)), 'códigos: lista');
await page.click('a[href="#/codigo/nuevo"]');
await waitView(page, '[data-promo]');
ok(/^KOVA[A-Z2-9]{6}$/.test(await page.inputValue('[name="code"]')), 'códigos: genera un código aleatorio');
await page.fill('[name="code"]', 'amigos15');
await page.fill('[name="name"]', 'Amigos');
await page.fill('[name="amount"]', '15');
await page.waitForSelector('[data-preview] table', { timeout: 8000 });
ok(/61\.200/.test(await page.textContent('[data-preview]')), 'códigos: vista previa de precio final por producto');
await page.click('[data-save]');
await page.waitForFunction(() => /#\/codigo\/[0-9a-f-]{36}$/.test(location.hash), null, { timeout: 10000 });
ok(true, 'códigos: crear (queda inactivo por defecto)');
await tab(page, 'codigos', 'Códigos');
await waitView(page, '.adm-table');
t = await text(page);
ok(/AMIGOS15/.test(t) && /Inactivo/.test(t), 'códigos: nuevo código en mayúsculas e inactivo');
await page.click('a[title="Estadísticas e historial"] >> nth=-1');
await waitView(page, '.adm-kpis');
t = await text(page);
ok(/KOVA-PSY-000001/.test(t) && /Usos confirmados/.test(t), 'códigos: estadísticas e historial de usos');
await page.screenshot({ path: `${SHOTS}/14-admin-codigo-stats.png`, fullPage: true });

// Producción
await tab(page, 'produccion', 'Producción');
await waitView(page, '.adm-matrix');
ok(/Anima Aetherna/.test(await text(page)), 'producción: matriz con la unidad confirmada');
await page.screenshot({ path: `${SHOTS}/15-admin-produccion.png`, fullPage: true });

// Inventario
await tab(page, 'inventario', 'Inventario');
await waitView(page, '[data-prod]');
await page.click('[data-prod="anima-aetherna"] .adm-costs summary').catch(() => {});
await page.fill('[data-prod="anima-aetherna"] [data-unit-cost]', '30000');
await page.click('[data-prod="anima-aetherna"] [data-save]');
await page.waitForFunction(() => /Margen a precio completo/.test(document.querySelector('[data-prod="anima-aetherna"]')?.textContent ?? ''), null, { timeout: 10000 });
ok(true, 'inventario: guardar costo y ver margen');

// Clientes, estadísticas, configuración
await tab(page, 'clientes', 'Clientes');
await waitView(page, '.adm-table');
ok(/cliente@prueba\.co/.test(await text(page)), 'clientes: lista con pedidos');
await tab(page, 'estadisticas', 'Estadísticas');
await waitView(page, '.adm-charts');
ok((await page.$$('.adm-chart')).length >= 6, 'estadísticas: gráficas');
await page.screenshot({ path: `${SHOTS}/16-admin-estadisticas.png`, fullPage: true });
await tab(page, 'configuracion', 'Configuración');
await waitView(page, '[data-form="ship"]');
await page.fill('[data-form="ship"] [data-s="cost"] >> nth=0', '15000');
await page.click('[data-form="ship"] .adm-card__foot button');
await page.waitForTimeout(1200);
ok(/Envíos guardados/.test(await page.textContent('body')), 'configuración: guardar envíos');
await page.click('[data-form="profit"] .adm-card__foot button');
await page.waitForTimeout(800);

// Diseños de KOVA CUSTOM (pedido de tienda.mjs con frente y espalda subidos por el cliente)
await page.goto(`${SITE}/admin/index.html#/pedidos`);
await waitView(page, '.adm-orders');
await page.click('a.adm-strong >> text=KOVA-WEB-000001');
await waitView(page, '.adm-detail');
t = await text(page);
ok(/Diseños KOVA Custom/.test(t) && /e2e-diseno-frente\.png/.test(t) && /e2e-diseno-espalda\.png/.test(t), 'detalle: lista los diseños del cliente (frente y espalda)');
const sizes = spawnSync('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'kova', '-tAc', "select string_agg(size_bytes::text, ',') from public.order_design_files where status = 'active'"], { encoding: 'utf8' }).stdout.trim();
ok(sizes.split(',').every((n) => Number(n) > 1000), `detalle: los archivos guardados tienen su contenido real (${sizes} bytes)`);
const [dpop] = await Promise.all([page.context().waitForEvent('page', { timeout: 5000 }).catch(() => null), page.click('[data-design]:not([data-dl]) >> nth=0')]);
await dpop?.waitForURL(/custom-designs/, { timeout: 5000 }).catch(() => {});
ok(dpop && /\/storage\/v1\/object\/sign\/custom-designs\//.test(dpop.url()), 'detalle: el diseño se abre con URL firmada temporal');
await dpop?.close();
await page.screenshot({ path: `${SHOTS}/15b-admin-disenos.png`, fullPage: true });

// Móvil
const m = await newPage({ width: 390, height: 844 });
await login(m, 'owner@test');
await m.goto(`${SITE}/admin/index.html#/pedidos`);
await m.waitForSelector('[data-view] .adm-orders', { timeout: 10000 });
await m.screenshot({ path: `${SHOTS}/17-admin-movil.png`, fullPage: false });

// Rol producción
const p2 = await newPage({ width: 1280, height: 900 });
await login(p2, 'prod@test');
await p2.waitForSelector('[data-view] .adm-kpis', { timeout: 10000 });
ok((await p2.$$('.adm-tabs a')).length === 1, 'rol producción: solo ve Producción');
await p2.goto(`${SITE}/admin/index.html#/pedidos`);
await p2.waitForTimeout(1000);
ok(/#\/produccion/.test(p2.url()), 'rol producción: no entra a Pedidos');
ok(!/cliente@prueba|3001234567|Cliente Prueba/.test(await p2.textContent('[data-view]')), 'rol producción: no ve datos personales');
spawnSync('psql', ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', 'kova', '-qc', "update public.orders set fulfillment_status = 'confirmed' where number = 'KOVA-WEB-000001'"]);
await p2.reload();
await p2.waitForSelector('[data-view] [data-design]', { timeout: 10000 });
ok((await p2.$$('[data-view] [data-design]')).length === 2, 'rol producción: descarga los diseños del pedido confirmado');

ok(page.errors.length === 0, `sin errores JS (owner) ${page.errors.join(' | ')}`);
ok(m.errors.length === 0, `sin errores JS (móvil) ${m.errors.join(' | ')}`);
ok(p2.errors.length === 0, `sin errores JS (producción) ${p2.errors.join(' | ')}`);
await browser.close();
const failed = results.filter(([c]) => !c).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`);
process.exit(failed ? 1 : 0);
