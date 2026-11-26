/*
 * tests/browser/mock-supabase.mjs - a stand-in for the Supabase project, for
 * tests on this computer only: sign-up, sign-in and the dame_* calls, backed
 * by a throw-away PostgreSQL that runs the real db/core/*.sql.
 * Serves: browser tests. Must not change: it runs the very SQL the owner
 * pastes; it copies how Supabase answers (apikey header, user token in
 * Authorization, PT4xx refusals as HTTP 4xx). It is NOT proof that the real
 * project is set up right: the owner's first sign-in is.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KEY = 'sb_publishable_test_key_for_local_runs';

function lit(v) {
  if (v === null || v === undefined) { return 'null'; }
  if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
  if (typeof v === 'number' && Number.isFinite(v)) { return String(v); }
  return "'" + String(v).replace(/'/g, "''") + "'";
}

export async function startMock(port, { confirmEmail = true } = {}) {
  const db = new PGlite();
  await db.exec(await readFile(join(ROOT, 'tests/sql/local-shim.sql'), 'utf8'));
  for (const f of (await readdir(join(ROOT, 'db/core'))).filter((n) => /^\d{3}_.+\.sql$/.test(n)).sort()) {
    await db.exec(await readFile(join(ROOT, 'db/core', f), 'utf8'));
  }

  const users = new Map();      // email -> { id, password, name, confirmed }
  const tokens = new Map();     // access token -> claims
  const refreshes = new Map();  // refresh token -> { email, session_id }
  let queue = Promise.resolve();
  const calls = [];

  function session(email, sessionId) {
    const u = users.get(email);
    const access = 'at_' + randomUUID();
    const refresh = 'rt_' + randomUUID();
    const sid = sessionId || randomUUID();
    tokens.set(access, { sub: u.id, role: 'authenticated', email, session_id: sid, user_metadata: { name: u.name } });
    refreshes.set(refresh, { email, session_id: sid });
    return { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: 'bearer', user: { id: u.id, email } };
  }

  async function rpc(name, args, claims) {
    const role = claims ? 'authenticated' : 'anon';
    const list = Object.keys(args).map((k) => {
      if (!/^[a-z_]+$/.test(k)) { throw Object.assign(new Error('bad arg'), { code: 'PGRST202' }); }
      return k + ' => ' + lit(args[k]);
    }).join(', ');
    const sql = 'begin; select set_config(\'request.jwt.claims\', ' + lit(claims ? JSON.stringify(claims) : '') + ', true); ' +
      'set local role ' + role + '; select public.' + name + '(' + list + ') as r; commit;';
    try {
      const out = await db.exec(sql);
      return { status: 200, body: out[3].rows[0].r };
    } catch (err) {
      await db.exec('rollback');
      const code = err.code || 'XX000';
      const pt = /^PT(\d{3})$/.exec(code);
      const status = pt ? Number(pt[1]) : code === '42501' ? (claims ? 403 : 401) : 400;
      return { status, body: { code, message: err.message, details: err.detail || null, hint: null } };
    }
  }

  const server = createServer((req, res) => {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type',
      'Access-Control-Allow-Methods': 'POST, OPTIONS'
    };
    const reply = (status, body) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      queue = queue.then(async () => {
        const url = new URL(req.url, 'http://mock');
        const auth = req.headers.authorization || '';
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return reply(400, { error_code: 'bad_json' }); }
        calls.push({ path: url.pathname, auth: auth ? 'yes' : 'no' });

        if (req.headers.apikey !== KEY) { return reply(401, { message: 'Invalid API key' }); }
        // Like Supabase: an API key in the Authorization header is refused.
        if (auth && auth.slice(7) === KEY) { return reply(401, { message: 'Invalid JWT' }); }
        const claims = auth ? tokens.get(auth.slice(7)) : null;
        if (auth && !claims) { return reply(401, { code: 'PGRST301', message: 'JWT expired' }); }

        if (url.pathname === '/auth/v1/signup') {
          const email = String(body.email || '').toLowerCase();
          if (!/^\S+@\S+\.\S+$/.test(email)) { return reply(400, { error_code: 'email_address_invalid', msg: 'invalid' }); }
          if (String(body.password || '').length < 6) { return reply(422, { error_code: 'weak_password', msg: 'weak' }); }
          if (!users.has(email)) {
            users.set(email, { id: randomUUID(), password: body.password, name: (body.data || {}).name, confirmed: !confirmEmail });
          }
          return reply(200, confirmEmail ? { id: users.get(email).id, email } : session(email));
        }
        if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
          const u = users.get(String(body.email || '').toLowerCase());
          if (!u || u.password !== body.password) { return reply(400, { error_code: 'invalid_credentials', msg: 'Invalid login credentials' }); }
          if (!u.confirmed) { return reply(400, { error_code: 'email_not_confirmed', msg: 'Email not confirmed' }); }
          return reply(200, session(String(body.email).toLowerCase()));
        }
        if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'refresh_token') {
          const r = refreshes.get(body.refresh_token);
          if (!r) { return reply(400, { error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' }); }
          refreshes.delete(body.refresh_token);
          return reply(200, session(r.email, r.session_id));
        }
        if (url.pathname === '/auth/v1/logout') {
          if (auth) { tokens.delete(auth.slice(7)); }
          res.writeHead(204, cors); return res.end();
        }
        const m = /^\/rest\/v1\/rpc\/(dame_[a-z_]+)$/.exec(url.pathname);
        if (m) {
          const out = await rpc(m[1], body, claims);
          return reply(out.status, out.body);
        }
        return reply(404, { message: 'not found' });
      }).catch((err) => { reply(500, { message: String(err) }); });
    });
  });
  await new Promise((resolve) => server.listen(port, '127.0.0.1', resolve));

  return {
    server, db, calls,
    confirm(email) { users.get(email.toLowerCase()).confirmed = true; },
    // A confirmed sign-in account plus an approved profile, without clicking through sign-up.
    async addUser(email, name, password, isIt = false) {
      const id = randomUUID();
      users.set(email, { id, password, name, confirmed: true });
      await db.query('insert into core.profiles (id, email, name, status, is_it) values ($1, $2, $3, $4, $5)', [id, email, name, 'active', isIt]);
      return id;
    },
    expireTokens() { tokens.clear(); },   // access tokens run out; renewal tokens stay
    sql(text) { return db.query(text); }
  };
}
