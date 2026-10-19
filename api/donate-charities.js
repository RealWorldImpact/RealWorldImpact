const BASE = 'https://www.donate.gg/api/v1/charities';
let cached = null;
let inflight = null;

export function normalizeCharity(row) {
  if (row.status !== 'ACTIVE_ONBOARDED' || row.isEnabled !== true) return null;
  if (!/^[a-zA-Z0-9-]+$/.test(row.id || '') || !/^[a-z0-9-]+$/.test(row.slug || '') || !row.name?.trim()) return null;
  return { id: row.id, slug: row.slug, name: row.name, logo: /^https:\/\//.test(row.logo || '') ? row.logo : '', status: row.status, isEnabled: true };
}

async function readDirectory() {
  const charities = new Map();
  const cursors = new Set();
  let cursor = null;
  const signal = AbortSignal.timeout(15000);
  for (let page = 0; page < 25; page++) {
    const url = new URL(BASE);
    url.search = new URLSearchParams({ limit: '200', publicOnly: 'true', directDonationOnly: 'true', orderMode: 'alphabetical', ...(cursor ? { cursor } : {}) });
    const response = await fetch(url, { headers: { accept: 'application/json' }, signal });
    if (!response.ok) throw new Error('Donate.gg directory unavailable');
    const body = await response.json();
    if (!Array.isArray(body.response)) throw new Error('Invalid directory response');
    for (const row of body.response) {
      const charity = normalizeCharity(row);
      if (charity) charities.set(charity.id, charity);
    }
    if (!body.pageKey) return { checkedAt: new Date().toISOString(), charities: [...charities.values()].sort((a, b) => a.id.localeCompare(b.id)) };
    if (cursors.has(body.pageKey)) throw new Error('Repeated directory cursor');
    cursors.add(body.pageKey);
    cursor = body.pageKey;
  }
  throw new Error('Incomplete directory');
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
  try {
    if (!cached || Date.now() - cached.at > 300000) {
      if (!inflight) inflight = readDirectory().finally(() => { inflight = null; });
      const body = await inflight;
      cached = { at: Date.now(), body };
    }
    res.setHeader('Cache-Control', 'public, s-maxage=300');
    return res.status(200).json(cached.body);
  } catch {
    res.setHeader('Cache-Control', 'no-store');
    return res.status(502).json({ error: 'Donate.gg claimed charities are temporarily unavailable' });
  }
}
