/**
 * Prueba de punta a punta de la tienda en Chrome (sin conexión a producción):
 * las llamadas a Supabase se redirigen al simulador local (mock-supabase.mjs) que usa la base de pruebas.
 *   node tests/e2e/tienda.mjs            (requiere http-server en :8080 y el simulador en :54321)
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
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
    const req = route.request();
    const u = new URL(req.url());
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
    const res = await fetch(`http://localhost:54321${u.pathname}${u.search}`, { method: req.method(), headers: req.headers(), body: req.postDataBuffer() ?? undefined });
    route.fulfill({ status: res.status, headers: Object.fromEntries(res.headers), body: Buffer.from(await res.arrayBuffer()) });
  });
  await ctx.route(/fonts\.(googleapis|gstatic)\.com|api\.fontshare\.com|cdn\.fontshare\.com/, (r) => r.abort());
  const page = await ctx.newPage();
  page.errors = [];
  page.on('pageerror', (e) => page.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  return page;
}

const page = await newPage({ width: 390, height: 844 });

// 1. Catálogo
await page.goto(`${SITE}/index.html`);
await page.waitForSelector('.card, .product-card, [data-quick]', { timeout: 10000 });
const html = await page.content();
ok(/Pre-order/i.test(html), 'catálogo muestra la etiqueta PRE-ORDER');
ok(/Reserva con/.test(html), 'catálogo muestra el anticipo (Reserva con $...)');
await page.screenshot({ path: `${SHOTS}/01-catalogo.png`, fullPage: false });

// 2. Ficha de producto en preventa
await page.goto(`${SITE}/producto.html?id=anima-aetherna`);
await page.waitForSelector('[data-countdown]', { timeout: 10000 });
const pdp = await page.textContent('main');
ok(/RESERVAR AHORA/i.test(pdp), 'ficha: botón RESERVAR AHORA');
ok(/Despacho estimado|despacho/i.test(pdp), 'ficha: fecha estimada de despacho');
ok(/36\.000/.test(pdp), 'ficha: anticipo del 50% = $36.000');
const cd1 = await page.textContent('[data-countdown]');
await page.waitForTimeout(1500);
const cd2 = await page.textContent('[data-countdown]');
ok(cd1 !== cd2, 'ficha: el contador avanza en tiempo real');
await page.screenshot({ path: `${SHOTS}/02-ficha-preventa.png`, fullPage: true });
await page.click('[data-add]');
ok(/Elige/i.test(await page.textContent('main')), 'ficha: pide elegir talla/color antes de reservar');
await page.click('.color >> nth=0');
await page.click('.size:not(.color) >> text=M');
await page.click('[data-qty-step="1"]');
await page.click('[data-add]');
await page.waitForTimeout(400);
const cart = await page.evaluate(() => JSON.parse(localStorage.getItem(Object.keys(localStorage).find((k) => /cart/i.test(k) && !/buyer|promo|key/i.test(k))) || 'null'));
ok(JSON.stringify(cart).includes('anima-aetherna'), 'ficha: la reserva queda en el carrito');

// 3. Carrito y código promocional
await page.goto(`${SITE}/carrito.html`);
await page.waitForSelector('[data-promo]');
await page.fill('[data-promo] input', 'noexiste');
await page.click('[data-promo-apply]');
await page.waitForSelector('[data-promo-msg].is-error', { timeout: 8000 });
ok(true, 'carrito: código inexistente muestra error');
await page.fill('[data-promo] input', 'prueba10');
await page.click('[data-promo-apply]');
await page.waitForSelector('[data-promo-applied]:not([hidden])', { timeout: 8000 });
const cartTxt = await page.textContent('main');
ok(/PRUEBA10/.test(cartTxt), 'carrito: código aplicado sin importar mayúsculas');
ok(/14\.400/.test(cartTxt), 'carrito: descuento 10% de 2 × $72.000 = $14.400');
await page.screenshot({ path: `${SHOTS}/03-carrito.png`, fullPage: true });
await page.click('[data-checkout-cta]');

// 4. Checkout
await page.waitForURL(/checkout\.html/);
await page.waitForSelector('.co-sum', { timeout: 10000 });
let sum = await page.textContent('[data-quote]');
ok(/129\.600/.test(sum), 'checkout: total con descuento $129.600 (calculado por el servidor)');
ok(/64\.800/.test(sum), 'checkout: valor a pagar ahora = 50% después del descuento ($64.800)');
await page.click('[data-submit]');
ok(/Revisa los campos/.test(await page.textContent('[data-state]')), 'checkout: valida campos obligatorios');
await page.fill('#co-name', 'Cliente Prueba');
await page.fill('#co-phone', '3001234567');
await page.fill('#co-email', 'cliente@prueba.co');
await page.fill('#co-department', 'Valle del Cauca');
await page.fill('#co-city', 'Cali');
const addr = await page.$('#co-address');
if (await addr.isVisible()) await page.fill('#co-address', 'Calle 1 # 2-3');
await page.click('.co-option:has([name="payment"]) >> nth=0');
await page.click('.co-option:has([name="plan"][value="full"])');
await page.waitForTimeout(800);
sum = await page.textContent('[data-quote]');
ok(/Valor a pagar ahora\s*\$\s?129\.600/.test(sum.replace(/\s+/g, ' ')), 'checkout: pago completo cobra el 100% ahora');
await page.click('.co-option:has([name="plan"][value="deposit"])');
await page.waitForTimeout(800);
await page.click('[data-submit]');
ok(/acepta las condiciones/.test(await page.textContent('[data-legal-error]')), 'checkout: exige aceptar condiciones y datos');
await page.check('[name="accept_terms"]', { force: true });
await page.check('[name="accept_data"]', { force: true });
await page.screenshot({ path: `${SHOTS}/04-checkout.png`, fullPage: true });
await page.click('[data-submit]');

// 5. Confirmación y seguimiento
await page.waitForTimeout(2500);
if (!/pedido\.html/.test(page.url())) console.log('estado checkout:', await page.textContent('[data-state]'), await page.textContent('[data-quote]'));
await page.waitForURL(/pedido\.html\?nuevo=1#[0-9a-f]{64}/, { timeout: 15000 });
await page.waitForSelector('.o-grid', { timeout: 10000 });
const ord = await page.textContent('main');
const num = (ord.match(/KOVA-PSY-\d{6}|PSY-\d{6}/) || [])[0];
ok(num, `seguimiento: número de pedido con prefijo de la campaña (${num})`);
ok(/Solicitud registrada/.test(ord), 'seguimiento: banner de solicitud registrada');
ok(/Pendiente/i.test(ord), 'seguimiento: estado pendiente hasta verificar el pago');
const wa = await page.getAttribute('[data-wa]', 'href');
ok(wa.startsWith('https://wa.me/573116983724') && decodeURIComponent(wa).includes(num), 'seguimiento: WhatsApp con el número de pedido al número de KOVA');
await page.screenshot({ path: `${SHOTS}/05-seguimiento.png`, fullPage: true });

// 6. Comprobante
const proof = '/tmp/e2e-comprobante.png';
fs.writeFileSync(proof, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
await page.setInputFiles('#up-file', proof);
await page.fill('#up-ref', 'M123456');
await page.click('[data-up-btn]');
await page.waitForFunction(() => /Recibimos tu comprobante/.test(document.querySelector('main').textContent), null, { timeout: 15000 });
ok(true, 'seguimiento: comprobante subido y en revisión');
const token = page.url().split('#')[1];

// 7. El mismo comprobante no se puede reutilizar (otro pedido)
const page2 = await newPage({ width: 1280, height: 900 });
await page2.goto(`${SITE}/pedido.html#${'0'.repeat(64)}`);
await page2.waitForSelector('.o-error', { timeout: 10000 });
ok(/No pudimos abrir/.test(await page2.textContent('main')), 'seguimiento: un token inválido no muestra ningún pedido');
await page2.goto(`${SITE}/pedido.html#${token}`);
await page2.waitForSelector('.o-grid');
await page2.screenshot({ path: `${SHOTS}/06-seguimiento-escritorio.png`, fullPage: true });
await page2.goto(`${SITE}/condiciones.html`);
await page2.waitForTimeout(800);
ok(/Ley 1480/.test(await page2.textContent('main')), 'condiciones: textos legales visibles');

ok(page.errors.length === 0, `sin errores de JavaScript en móvil ${page.errors.join(' | ')}`);
ok(page2.errors.length === 0, `sin errores de JavaScript en escritorio ${page2.errors.join(' | ')}`);
await browser.close();
const failed = results.filter(([c]) => !c).length;
console.log(`\n${results.length - failed}/${results.length} comprobaciones correctas`);
process.exit(failed ? 1 : 0);
