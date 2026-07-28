const CACHE_MS = 60_000;
const cache = new Map();
const DEX_BASE = 'https://api.geckoterminal.com/api/v2/networks/robinhood/dexes/pons-dot-family/pools?include=base_token%2Cquote_token&sort=h24_volume_usd_desc&page=';
const POOL_BASE = 'https://api.geckoterminal.com/api/v2/networks/robinhood/pools/';
const TOKEN_BASE = 'https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/';

function cacheKey(req) {
  return `${req.query.kind || ''}:${req.query.page || ''}:${req.query.address || ''}`;
}

function upstreamUrl(req) {
  if (req.query.kind === 'dex') {
    const page = Number.parseInt(req.query.page, 10);
    if (!Number.isInteger(page) || page < 1 || page > 100) return null;
    return `${DEX_BASE}${page}`;
  }
  if (req.query.kind === 'pool' && /^0x[a-fA-F0-9]{40}$/.test(req.query.address || '')) {
    return `${POOL_BASE}${req.query.address.toLowerCase()}?include=base_token%2Cquote_token`;
  }
  if (req.query.kind === 'token' && /^0x[a-fA-F0-9]{40}$/.test(req.query.address || '')) {
    return `${TOKEN_BASE}${req.query.address.toLowerCase()}`;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  const url = upstreamUrl(req);
  if (!url) return res.status(400).json({ error: 'Invalid GeckoTerminal request' });

  const key = cacheKey(req);
  const saved = cache.get(key);
  if (saved && Date.now() - saved.timestamp < CACHE_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(saved.body);
  }

  try {
    const upstream = await fetch(url, { headers: { accept: 'application/json' } });
    const body = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json(body);
    cache.set(key, { timestamp: Date.now(), body });
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=60');
    return res.status(200).json(body);
  } catch {
    return res.status(502).json({ error: 'GeckoTerminal is temporarily unavailable' });
  }
}
