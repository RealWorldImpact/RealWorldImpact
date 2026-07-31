const RPC_URL = 'https://rpc.mainnet.chain.robinhood.com';
const ALLOWED_METHODS = new Set(['eth_blockNumber', 'eth_call', 'eth_getLogs', 'eth_getBlockByNumber']);
const MAX_BATCH_SIZE = 100;
const MAX_PAYLOAD_BYTES = 100_000;
const WINDOW_MS = 60_000;
const MAX_REQUESTS_PER_WINDOW = 80;
const visitors = new Map();

function visitorKey(req) {
  const forwarded=req.headers['x-forwarded-for'];
  return (Array.isArray(forwarded) ? forwarded[0] : forwarded || req.socket?.remoteAddress || 'unknown').split(',')[0].trim();
}

function allowRequest(req) {
  const key=visitorKey(req);
  const now=Date.now();
  const prior=visitors.get(key);
  const state=!prior || now-prior.startedAt>=WINDOW_MS ? {startedAt:now,count:0} : prior;
  state.count++;
  visitors.set(key,state);
  return state.count<=MAX_REQUESTS_PER_WINDOW;
}

function validRequest(item) {
  if (!item || typeof item !== 'object' || !ALLOWED_METHODS.has(item.method) || !Array.isArray(item.params)) return false;
  if (item.method === 'eth_blockNumber') return item.params.length === 0;
  if (item.method === 'eth_getBlockByNumber') return item.params.length === 2 && /^0x[0-9a-fA-F]+$/.test(item.params[0] || '') && item.params[1] === false;
  if (item.method === 'eth_call') {
    const call=item.params[0];
    return item.params.length === 2 && call && /^0x[a-fA-F0-9]{40}$/.test(call.to || '') && /^0x[a-fA-F0-9]*$/.test(call.data || '');
  }
  const filter=item.params[0];
  const address=value=>typeof value==='string' && /^0x[a-fA-F0-9]{40}$/.test(value);
  const addresses=address(filter?.address) || (Array.isArray(filter?.address) && filter.address.length>0 && filter.address.length<=150 && filter.address.every(address));
  return item.params.length === 1 && filter && addresses && Array.isArray(filter.topics || []) && filter.topics.length<=4;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  if (!allowRequest(req)) return res.status(429).json({ error: 'Too many RPC requests; try again shortly' });
  const payload = req.body;
  const items = Array.isArray(payload) ? payload : [payload];
  const payloadSize=JSON.stringify(payload ?? null).length;
  if (!items.length || items.length>MAX_BATCH_SIZE || payloadSize>MAX_PAYLOAD_BYTES || !items.every(validRequest)) return res.status(400).json({ error: 'Unsupported RPC request' });

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
