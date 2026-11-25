/**
 * Simulador mínimo de Supabase para pruebas locales (NO es para producción).
 * Traduce las llamadas REST/RPC, de sesión y de almacenamiento que hacen la tienda y el panel a SQL
 * contra el Postgres local (psql), aplicando el rol y la identidad del token: así las políticas RLS y
 * las funciones del servidor se ejecutan exactamente igual que en Supabase.
 *
 *   node tests/e2e/mock-supabase.mjs   → http://localhost:54321
 */
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const PORT = Number(process.env.MOCK_PORT || 54321);
const PSQL = ['-h', '/tmp', '-p', '5433', '-U', 'postgres', '-d', process.env.MOCK_DB || 'kova', '-tA', '-v', 'ON_ERROR_STOP=1', '-q'];
const FILES = '/tmp/mock-storage';
fs.mkdirSync(FILES, { recursive: true });

const q = (v) => { const tag = `q${crypto.randomBytes(4).toString('hex')}`; return `$${tag}$${v}$${tag}$`; };
const ident = (s) => { if (!/^[a-z_][a-z0-9_]*$/i.test(s)) throw new Error(`identificador inválido: ${s}`); return `"${s}"`; };

function sql(statement, { role = 'anon', sub = '', headers = {} } = {}) {
  const full = `begin; set local role ${role === 'authenticated' ? 'authenticated' : 'anon'};
    select set_config('request.jwt.claim.sub', ${q(sub)}, true), set_config('request.jwt.claim.role', ${q(role)}, true),
           set_config('request.headers', ${q(JSON.stringify(headers))}, true) \\g /dev/null
    ${statement};
    commit;`;
  const r = spawnSync('psql', [...PSQL, '-c', full], { encoding: 'utf8' });
  if (r.status !== 0) {
    const msg = (r.stderr.match(/ERROR:\s+(.*)/) || [])[1] || r.stderr.trim();
    const err = new Error(msg); err.pg = true; throw err;
  }
  const out = r.stdout.trim().split('\n').filter(Boolean).pop() ?? '';
  return out;
}

// Tipos de argumentos de las funciones públicas (para convertir el JSON del cuerpo).
const fnTypes = {};
function loadFns() {
  const rows = spawnSync('psql', [...PSQL, '-c', `select json_agg(json_build_object('n', p.proname, 'a', p.proargnames, 't',
      (select json_agg(format_type(t, null)) from unnest(p.proargtypes) t)))
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public'`], { encoding: 'utf8' }).stdout;
  for (const f of JSON.parse(rows)) fnTypes[f.n] = (f.a || []).map((name, i) => ({ name, type: f.t?.[i] }));
}

function claims(req) {
  const auth = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  try {
    const p = JSON.parse(Buffer.from(auth.split('.')[1], 'base64url').toString());
    if (p.role === 'authenticated' && p.sub) return { role: 'authenticated', sub: p.sub, email: p.email };
  } catch { /* clave pública */ }
  return { role: 'anon', sub: '' };
}

function filters(params) {
  const where = [];
  for (const [k, v] of params) {
    if (['select', 'order', 'limit', 'offset', 'on_conflict', 'columns'].includes(k)) continue;
    const [op, ...rest] = v.split('.'); const val = rest.join('.');
    const col = ident(k);
    if (op === 'eq') where.push(`${col}::text = ${q(val)}`);
    else if (op === 'neq') where.push(`${col}::text <> ${q(val)}`);
    else if (op === 'gte') where.push(`${col} >= ${q(val)}`);
    else if (op === 'lte') where.push(`${col} <= ${q(val)}`);
    else if (op === 'lt') where.push(`${col} < ${q(val)}`);
    else if (op === 'gt') where.push(`${col} > ${q(val)}`);
    else if (op === 'is') where.push(`${col} is ${val === 'null' ? 'null' : val === 'true' ? 'true' : 'false'}`);
    else if (op === 'ilike') where.push(`${col}::text ilike ${q(val.replace(/\*/g, '%'))}`);
    else if (op === 'in') where.push(`${col}::text = any(${q(`{${val.slice(1, -1)}}`)}::text[])`);
    else throw new Error(`filtro no soportado: ${op}`);
  }
  return where.length ? ` where ${where.join(' and ')}` : '';
}
const orderBy = (o) => (o ? ` order by ${o.split(',').map((p) => { const [c, dir, nulls] = p.split('.'); return `${ident(c)} ${dir === 'desc' ? 'desc' : 'asc'}${nulls === 'nullslast' ? ' nulls last' : ''}`; }).join(', ')}` : '');
const cols = (s) => (!s || s === '*' ? '*' : s.split(',').map((c) => ident(c.trim())).join(', '));

function send(res, status, body, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json', ...cors, ...headers });
  res.end(body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body));
}
const cors = {
  'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,PUT,OPTIONS',
  'Access-Control-Expose-Headers': 'Content-Range',
};
const pgError = (res, err) => {
  const code = /permission denied|row-level security/.test(err.message) ? 403 : /duplicate key/.test(err.message) ? 409 : 400;
  send(res, code, { code: code === 409 ? '23505' : code === 403 ? '42501' : 'P0001', message: err.message, details: null, hint: null });
};

function fakeJwt(user) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'HS256', typ: 'JWT' })}.${b({ sub: user.id, email: user.email, role: 'authenticated', aud: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 })}.sig`;
}
function session(user) {
  return { access_token: fakeJwt(user), token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: `r-${user.id}`, user: { id: user.id, email: user.email, aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {} } };
}
const findUser = (where) => JSON.parse(spawnSync('psql', [...PSQL, '-c', `select coalesce(json_agg(u), '[]') from auth.users u where ${where}`], { encoding: 'utf8' }).stdout)[0];

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204);
  const url = new URL(req.url, 'http://x');
  const chunks = []; for await (const c of req) chunks.push(c);
  const raw = Buffer.concat(chunks);
  const body = () => (raw.length ? JSON.parse(raw.toString()) : {});
  const who = claims(req);
  const headers = { 'x-forwarded-for': req.headers['x-test-ip'] || '127.0.0.1' };
  try {
    // ---------- Sesión ----------
    if (url.pathname === '/auth/v1/token') {
      const b = body();
      const user = url.searchParams.get('grant_type') === 'refresh_token'
        ? findUser(`'r-' || id::text = ${q(b.refresh_token || '')}`)
        : (b.password === 'kova-test' ? findUser(`email = ${q(b.email || '')}`) : null);
      if (!user) return send(res, 400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' });
      return send(res, 200, session(user));
    }
    if (url.pathname === '/auth/v1/user') {
      if (who.role !== 'authenticated') return send(res, 401, { msg: 'JWT expired' });
      return send(res, 200, { id: who.sub, email: who.email, aud: 'authenticated', role: 'authenticated' });
    }
    if (url.pathname === '/auth/v1/logout') return send(res, 204);
    if (url.pathname.startsWith('/auth/v1/')) return send(res, 200, {});

    // ---------- Almacenamiento ----------
    let m = url.pathname.match(/^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/);
    if (m && req.method === 'POST') {
      const [, bucket, p] = m; const name = decodeURIComponent(p);
      const n = sql(`select count(*) from storage.objects where bucket_id = ${q(bucket)} and name = ${q(name)}`, { ...who, headers });
      if (n !== '1') return send(res, 400, { statusCode: '404', error: 'not_found', message: 'Object not found' });
      return send(res, 200, { signedURL: `/object/sign/${bucket}/${p}?token=test` });
    }
    if (m && req.method === 'GET') {
      const file = path.join(FILES, m[1], decodeURIComponent(m[2]));
      if (!fs.existsSync(file)) return send(res, 404, {});
      res.writeHead(200, { ...cors, 'Content-Type': 'application/octet-stream' }); return res.end(fs.readFileSync(file));
    }
    m = url.pathname.match(/^\/storage\/v1\/object\/([^/]+)\/(.+)$/);
    if (m && (req.method === 'POST' || req.method === 'PUT')) {
      const [, bucket, p] = m; const name = decodeURIComponent(p);
      const limit = Number(sql(`select coalesce(file_size_limit, 0) from storage.buckets where id = ${q(bucket)}`, { role: 'anon' }) || 0);
      if (limit && raw.length > limit) return send(res, 400, { statusCode: '413', error: 'Payload too large', message: 'The object exceeded the maximum allowed size' });
      try { sql(`insert into storage.objects (bucket_id, name, metadata) values (${q(bucket)}, ${q(name)}, ${q(JSON.stringify({ size: raw.length }))}::jsonb)`, { ...who, headers }); } catch (err) {
        return send(res, 400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
      }
      const file = path.join(FILES, bucket, name); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, raw);
      return send(res, 200, { Key: `${bucket}/${name}` });
    }
    if (url.pathname.startsWith('/storage/v1/object/public/')) { res.writeHead(404, cors); return res.end(); }

    // ---------- RPC ----------
    m = url.pathname.match(/^\/rest\/v1\/rpc\/([a-z_0-9]+)$/);
    if (m) {
      const fn = m[1]; const args = body();
      if (!fnTypes[fn]) loadFns();
      const sig = fnTypes[fn];
      if (!sig) return send(res, 404, { code: 'PGRST202', message: `Could not find the function public.${fn}` });
      const parts = sig.filter((a) => a.name in args).map((a) => {
        const v = args[a.name];
        if (v === null) return `${ident(a.name)} => null`;
        if (a.type === 'jsonb') return `${ident(a.name)} => ${q(JSON.stringify(v))}::jsonb`;
        if (a.type.endsWith('[]')) return `${ident(a.name)} => ${q(`{${v.join(',')}}`)}::${a.type}`;
        return `${ident(a.name)} => ${q(String(v))}::${a.type}`;
      });
      const out = sql(`select to_jsonb(public.${ident(fn)}(${parts.join(', ')}))`, { ...who, headers });
      return send(res, 200, out || 'null');
    }

    // ---------- Tablas ----------
    m = url.pathname.match(/^\/rest\/v1\/([a-z_]+)$/);
    if (m) {
      const t = `public.${ident(m[1])}`; const p = url.searchParams;
      const single = /vnd\.pgrst\.object/.test(req.headers.accept || '');
      const ret = (out) => {
        const rows = JSON.parse(out || '[]');
        if (single) return rows.length === 1 ? send(res, 200, rows[0]) : send(res, 406, { code: 'PGRST116', message: 'JSON object requested, multiple (or no) rows returned' });
        return send(res, 200, rows, { 'Content-Range': `0-${Math.max(rows.length - 1, 0)}/*` });
      };
      if (req.method === 'GET') {
        const lim = p.get('limit') ? ` limit ${Number(p.get('limit'))}` : '';
        const off = p.get('offset') ? ` offset ${Number(p.get('offset'))}` : '';
        return ret(sql(`select coalesce(jsonb_agg(x), '[]') from (select ${cols(p.get('select'))} from ${t}${filters(p)}${orderBy(p.get('order'))}${lim}${off}) x`, { ...who, headers }));
      }
      if (req.method === 'POST') {
        const b = body(); const list = Array.isArray(b) ? b : [b];
        const keys = [...new Set(list.flatMap((o) => Object.keys(o)))].map(ident);
        const prefer = req.headers.prefer || '';
        let conflict = '';
        if (/resolution=merge-duplicates/.test(prefer)) conflict = ` on conflict (${p.get('on_conflict').split(',').map(ident).join(', ')}) do update set ${keys.map((k) => `${k} = excluded.${k}`).join(', ')}`;
        if (/resolution=ignore-duplicates/.test(prefer)) conflict = ' on conflict do nothing';
        return ret(sql(`with ins as (insert into ${t} (${keys.join(', ')}) select ${keys.join(', ')} from jsonb_populate_recordset(null::${t}, ${q(JSON.stringify(list))}::jsonb)${conflict} returning *)
          select coalesce(jsonb_agg(ins), '[]') from ins`, { ...who, headers }));
      }
      if (req.method === 'PATCH') {
        const b = body(); const keys = Object.keys(b).map(ident);
        return ret(sql(`with up as (update ${t} set (${keys.join(', ')}${keys.length === 1 ? ', ' + keys[0] : ''}) = (select ${keys.join(', ')}${keys.length === 1 ? ', ' + keys[0] : ''} from jsonb_populate_record(null::${t}, ${q(JSON.stringify(b))}::jsonb))${filters(p)} returning *)
          select coalesce(jsonb_agg(up), '[]') from up`, { ...who, headers }));
      }
      if (req.method === 'DELETE') {
        return ret(sql(`with d as (delete from ${t}${filters(p)} returning *) select coalesce(jsonb_agg(d), '[]') from d`, { ...who, headers }));
      }
    }
    send(res, 404, { message: `no simulado: ${req.method} ${url.pathname}` });
  } catch (err) {
    if (err.pg) return pgError(res, err);
    console.error(err);
    send(res, 500, { message: String(err.message) });
  }
});
loadFns();
server.listen(PORT, () => console.log(`mock supabase en http://localhost:${PORT}`));
