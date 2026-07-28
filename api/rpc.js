const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const ALLOWED_METHODS = new Set(['eth_blockNumber', 'eth_call', 'eth_getLogs']);

function validRequest(item) {
  return item && typeof item === 'object' && ALLOWED_METHODS.has(item.method) && Array.isArray(item.params);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const payload = req.body;
  const items = Array.isArray(payload) ? payload : [payload];
  if (!items.length || !items.every(validRequest)) return res.status(400).json({ error: 'Unsupported RPC request' });

  try {
    const upstream = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const body = await upstream.text();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Cache-Control', 'no-store');
    return res.status(upstream.status).send(body);
  } catch {
    return res.status(502).json({ error: 'Robinhood Chain RPC is temporarily unavailable' });
  }
}
