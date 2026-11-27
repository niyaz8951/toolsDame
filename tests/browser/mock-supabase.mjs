/*
 * tests/browser/mock-supabase.mjs - a stand-in for the Supabase project, for
 * tests on this computer only: sign-up, sign-in and the dame_* calls, backed
 * by a throw-away PostgreSQL that runs the real db/*.sql.
 * Serves: browser tests. Must not change: it runs the very SQL the owner
 * pastes; it copies how Supabase answers (apikey header, user token in
 * Authorization, PT4xx refusals as HTTP 4xx). It is NOT proof that the real
 * project is set up right: the owner's first sign-in is.
 */
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite } from '@electric-sql/pglite';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const KEY = 'sb_publishable_test_key_for_local_runs';

function lit(v) {
  if (v === null || v === undefined) { return 'null'; }
  if (typeof v === 'boolean') { return v ? 'true' : 'false'; }
  if (typeof v === 'number' && Number.isFinite(v)) { return String(v); }
  if (typeof v === 'object') { return "'" + JSON.stringify(v).replace(/'/g, "''") + "'::jsonb"; }
  return "'" + String(v).replace(/'/g, "''") + "'";
}

export async function startMock(port, { confirmEmail = true } = {}) {
  const db = new PGlite();
  await db.exec(await readFile(join(ROOT, 'tests/sql/local-shim.sql'), 'utf8'));
  // The database as db/install.sql builds it: its files, in its order, in one transaction.
  const runner = await readFile(join(ROOT, 'db/install.sql'), 'utf8');
  const parts = [...runner.matchAll(/^\\ir\s+(\S+)/gm)].map((m) => m[1]);
  await db.exec('begin;\n' + (await Promise.all(parts.map((f) => readFile(join(ROOT, 'db', f), 'utf8')))).join('\n') + '\ncommit;');

  const users = new Map();      // email -> { id, password, name, confirmed }
  const tokens = new Map();     // access token -> claims
  const refreshes = new Map();  // refresh token -> { email, session_id }
  let queue = Promise.resolve();
  const calls = [];
  const stored = new Map();     // file name -> bytes

  // Like the real sign-in service: every account has a row in auth.users with its password hashed.
  async function keep(email) {
    const u = users.get(email);
    if (u.inDb) { return; }
    await db.query("insert into auth.users (id, email, encrypted_password) values ($1, $2, extensions.crypt($3, extensions.gen_salt('bf'))) on conflict (id) do update set encrypted_password = excluded.encrypted_password", [u.id, email, String(u.password)]);
  }

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
      'Access-Control-Allow-Headers': 'apikey, authorization, content-type, x-upsert, cache-control',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS'
    };
    const reply = (status, body) => {
      res.writeHead(status, { ...cors, 'Content-Type': 'application/json' });
      res.end(body === undefined ? '' : JSON.stringify(body));
    };
    if (req.method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    const chunks = [];
    req.on('data', (c) => { chunks.push(c); });
    req.on('end', () => {
      const bytes = Buffer.concat(chunks);
      const isFile = req.url.startsWith('/storage/v1/');
      const raw = isFile ? '' : bytes.toString('utf8');
      queue = queue.then(async () => {
        const url = new URL(req.url, 'http://mock');
        const auth = req.headers.authorization || '';
        let body = {};
        try { body = raw ? JSON.parse(raw) : {}; } catch (e) { return reply(400, { error_code: 'bad_json' }); }
        calls.push({ path: url.pathname, auth: auth ? 'yes' : 'no', body });

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
            await keep(email);
          }
          return reply(200, confirmEmail ? { id: users.get(email).id, email } : session(email));
        }
        if (url.pathname === '/auth/v1/token' && url.searchParams.get('grant_type') === 'password') {
          let u = users.get(String(body.email || '').toLowerCase());
          if (u) {
            // IT may have reset the password in the database (dame_user_password_reset): the stored hash decides, as in the real service.
            const now = await db.query('select encrypted_password = extensions.crypt($2, encrypted_password) as ok from auth.users where id = $1', [u.id, String(body.password || '')]).catch(() => ({ rows: [] }));
            if (now.rows[0]) { u.password = now.rows[0].ok ? body.password : null; }
          }
          if (!u) {
            // An account the database made itself (dame_user_create): checked against its stored hash, like the real service.
            const made = await db.query('select id::text as id, encrypted_password = extensions.crypt($2, encrypted_password) as ok, raw_user_meta_data ->> \'name\' as name from auth.users where email = $1', [String(body.email || '').toLowerCase(), String(body.password || '')]).catch(() => ({ rows: [] }));
            if (made.rows[0] && made.rows[0].ok) { u = { id: made.rows[0].id, password: body.password, name: made.rows[0].name, confirmed: true, inDb: true }; users.set(String(body.email).toLowerCase(), u); }
          }
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
        if (url.pathname === '/auth/v1/user' && req.method === 'PUT') {
          if (!claims) { return reply(401, { error_code: 'no_authorization', msg: 'no session' }); }
          const u = users.get(claims.email);
          if (String(body.password || '').length < 6) { return reply(422, { error_code: 'weak_password', msg: 'weak' }); }
          if (u.password === body.password) { return reply(422, { error_code: 'same_password', msg: 'New password should be different from the old password.' }); }
          // The stored hash decides whether it is the same password (IT may have reset it since this sign-in).
          const same = await db.query('select encrypted_password = extensions.crypt($2, encrypted_password) as ok from auth.users where id = $1', [u.id, String(body.password)]).catch(() => ({ rows: [] }));
          if (same.rows[0] && same.rows[0].ok) { return reply(422, { error_code: 'same_password', msg: 'New password should be different from the old password.' }); }
          u.password = body.password;
          await db.query('update auth.users set encrypted_password = extensions.crypt($2, extensions.gen_salt(\'bf\')) where id = $1', [u.id, body.password]);
          return reply(200, { id: u.id, email: claims.email });
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
        // The file store. Like Supabase Storage, it asks the database's own
        // row rules (the two dame_tools_* policies) for every single file.
        const up = /^\/storage\/v1\/object\/tools\/(.+)$/.exec(url.pathname);
        if (up && req.method === 'POST') {
          if (!claims) { return reply(400, { statusCode: '403', error: 'Unauthorized', message: 'no token' }); }
          const name = decodeURIComponent(up[1]);
          const bucket = (await db.query("select file_size_limit, allowed_mime_types from storage.buckets where id = 'tools'")).rows[0];
          if (!bucket) { return reply(400, { statusCode: '404', error: 'Bucket not found' }); }
          if (!bucket.allowed_mime_types.includes(String(req.headers['content-type']))) { return reply(400, { statusCode: '415', error: 'invalid_mime_type' }); }
          if (bytes.length > Number(bucket.file_size_limit)) { return reply(400, { statusCode: '413', error: 'Payload too large' }); }
          try {
            await db.exec("begin; select set_config('request.jwt.claims', " + lit(JSON.stringify(claims)) + ", true); set local role authenticated; " +
              "insert into storage.objects (bucket_id, name, owner, metadata) values ('tools', " + lit(name) + ", " + lit(claims.sub) + ", " +
              lit(JSON.stringify({ size: bytes.length, mimetype: 'text/html' })) + "); commit;");
          } catch (err) {
            await db.exec('rollback');
            return err.code === '23505' ? reply(400, { statusCode: '409', error: 'Duplicate' })
              : reply(400, { statusCode: '403', error: 'Unauthorized', message: 'new row violates row-level security policy' });
          }
          stored.set(name, bytes);
          return reply(200, { Key: 'tools/' + name });
        }
        const down = /^\/storage\/v1\/object\/authenticated\/tools\/(.+)$/.exec(url.pathname);
        if (down && req.method === 'GET') {
          const name = decodeURIComponent(down[1]);
          let seen = false;
          if (claims) {
            const out = await db.exec("begin; select set_config('request.jwt.claims', " + lit(JSON.stringify(claims)) + ", true); set local role authenticated; " +
              "select count(*)::int as n from storage.objects where bucket_id = 'tools' and name = " + lit(name) + "; commit;");
            seen = out[3].rows[0].n === 1;
          }
          if (!seen || !stored.has(name)) { return reply(400, { statusCode: '404', error: 'not_found', message: 'Object not found' }); }
          res.writeHead(200, { ...cors, 'Content-Type': 'text/html' });
          return res.end(stored.get(name));
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
      await keep(email);
      await db.query('insert into core.profiles (id, email, name, status, is_it) values ($1, $2, $3, $4, $5)', [id, email, name, 'active', isIt]);
      return id;
    },
    expireTokens() { tokens.clear(); },
    // Someone changes a stored file behind the platform's back.
    tamper(name, text) { if (!stored.has(name)) { throw new Error('no such file ' + name); } stored.set(name, Buffer.from(text)); },
    storedNames() { return [...stored.keys()]; },   // access tokens run out; renewal tokens stay
    sql(text) { return db.query(text); }
  };
}
