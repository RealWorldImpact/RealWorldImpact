/**
 * RWI v1 loss-ledger register backend.
 *
 * Matches the contract claims.html already expects from CLAIMS_ENDPOINT:
 *   GET  /            -> { claims: [ { address, ts }, ... ] }
 *   POST / {address,ts} -> stores one entry, 204 on success
 *
 * This is the fix for the register showing 0 wallets once hosted outside
 * Claude's own chat preview: window.storage (used as a fallback in
 * claims.html) only exists inside Claude's interface. Once this file is
 * hosted on an actual domain, only a real backend like this one is
 * genuinely shared across every visitor.
 *
 * Deploy (free tier is plenty for this):
 *   1. npm install -g wrangler   (Cloudflare's CLI)
 *   2. wrangler login
 *   3. wrangler kv namespace create RWI_CLAIMS
 *      -> copy the returned id into wrangler.toml (see below)
 *   4. wrangler deploy
 *   5. Copy the printed workers.dev URL into CFG.CLAIMS_ENDPOINT in
 *      claims.html, e.g. 'https://rwi-claims.<you>.workers.dev'
 *
 * wrangler.toml (create this alongside worker.js):
 *
 *   name = "rwi-claims"
 *   main = "worker.js"
 *   compatibility_date = "2024-01-01"
 *
 *   [[kv_namespaces]]
 *   binding = "RWI_CLAIMS"
 *   id = "<id from step 3>"
 *
 * To restrict writes to your own site instead of the open internet, add an
 * ALLOWED_ORIGIN check (see corsHeaders below) or a shared-secret header —
 * left open here since submissions are meant to be public by design, but
 * an allowlist keeps random scripts from spamming the KV store.
 */

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

// Set this to your real site once deployed, e.g. 'https://rwihood.org'.
// '*' works for testing but lets any site call this endpoint.
const ALLOWED_ORIGIN = '*';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'content-type',
  };
}

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', ...corsHeaders() },
  });
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method === 'GET') {
      // KV list() pages at 1000 keys by default; a real-world register of
      // v1 holders is very unlikely to exceed that, but this pages through
      // just in case rather than silently truncating the register.
      const claims = [];
      let cursor;
      do {
        const page = await env.RWI_CLAIMS.list({ prefix: 'claim:', cursor });
        for (const k of page.keys) {
          const parts = k.name.split(':');
          if (parts.length < 3 || !ADDR_RE.test(parts[1])) continue;
          claims.push({ address: parts[1], ts: Number(parts[2]) || 0 });
        }
        cursor = page.list_complete ? null : page.cursor;
      } while (cursor);
      return json({ claims });
    }

    if (request.method === 'POST') {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: 'Malformed JSON body' }, 400);
      }
      const address = String(body.address || '').toLowerCase();
      const ts = Number(body.ts) || Date.now();
      if (!ADDR_RE.test(address)) {
        return json({ error: 'address must be 0x followed by 40 hex characters' }, 400);
      }
      // One entry per wallet: check for an existing key with this address
      // before writing, so a resubmission doesn't create a second entry.
      // claims.html already dedupes on read too, but this keeps the KV
      // store itself clean rather than relying solely on client dedupe.
      const existing = await env.RWI_CLAIMS.list({ prefix: 'claim:' + address + ':' });
      if (existing.keys.length > 0) {
        return json({ ok: true, note: 'already registered' }, 200);
      }
      await env.RWI_CLAIMS.put('claim:' + address + ':' + ts, JSON.stringify({ address, ts }));
      return json({ ok: true }, 201);
    }

    return json({ error: 'Method not allowed' }, 405);
  },
};
