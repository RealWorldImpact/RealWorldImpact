const INDEXER_URL = 'https://indices.theindex.finance/api/indexer';
const TREASURY = '0xb2c088db84293a6e3dee0765596f1cfdc2b9334d';
const TOKEN = '0xda2598c976e62e7e15dcca75169b404712e48b04';
const ASSETS = {
  '0x0000000000000000000000000000000000000001': 'BURN',
  '0x0000000000000000000000000000000000000002': 'LIQUIDITY',
  '0x56910d4409f3a0c78c64dd8d0545ff0705389870': 'INDEX',
  '0x39dbed3a2bd333467115de45665cc57f813c4571': 'PONS',
};

const CACHE_MS = 30_000;
let cached = null;

const QUERY = `{
  treasurys(where: { id: "${TREASURY}" }, limit: 1) {
    items { id boundToken basket rounds burned liquiditySpent epochLength distributeBps }
  }
  treasuryAssets(where: { treasury_in: ["${TREASURY}"] }, limit: 200) {
    items { asset totalPaid totalSwept }
  }
}`;

function formatUnits(raw, decimals = 18) {
  const value = BigInt(raw || '0');
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = absolute / base;
  const fraction = (absolute % base).toString().padStart(decimals, '0').replace(/0+$/, '');
  return `${negative ? '-' : ''}${whole}${fraction ? `.${fraction}` : ''}`;
}

function buildPayload(body) {
  if (body?.errors?.length) throw new Error(body.errors[0]?.message || 'Index query failed');

  const treasury = body?.data?.treasurys?.items?.[0];
  if (!treasury || String(treasury.boundToken).toLowerCase() !== TOKEN) {
    throw new Error('RWI treasury data was not returned');
  }

  const basket = JSON.parse(treasury.basket || '[]');
  const allocation = basket.map(([address, weightBps]) => ({
    symbol: ASSETS[String(address).toLowerCase()] || 'UNKNOWN',
    weightBps: Number(weightBps),
  }));

  const distributed = (body?.data?.treasuryAssets?.items || []).map(item => {
    const raw = BigInt(item.totalPaid || '0') + BigInt(item.totalSwept || '0');
    return {
      symbol: ASSETS[String(item.asset).toLowerCase()] || 'UNKNOWN',
      amount: formatUnits(raw),
    };
  }).filter(item => item.symbol !== 'UNKNOWN' && item.amount !== '0');

  return {
    source: `https://indices.theindex.finance/coin/${TREASURY}`,
    treasury: TREASURY,
    token: TOKEN,
    allocation,
    distributed,
    rwiBurned: formatUnits(treasury.burned),
    liquiditySpentWei: String(treasury.liquiditySpent || '0'),
    rounds: Number(treasury.rounds || 0),
    epochLengthSeconds: Number(treasury.epochLength || 0),
    updatedAt: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  if (cached && Date.now() - cached.timestamp < CACHE_MS) {
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    return res.status(200).json(cached.body);
  }

  try {
    const upstream = await fetch(INDEXER_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ query: QUERY }),
      signal: AbortSignal.timeout(8_000),
    });
    const body = await upstream.json();
    if (!upstream.ok) return res.status(upstream.status).json({ error: 'The Index is temporarily unavailable' });

    const payload = buildPayload(body);
    cached = { timestamp: Date.now(), body: payload };
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    return res.status(200).json(payload);
  } catch {
    return res.status(502).json({ error: 'The Index rewards feed is temporarily unavailable' });
  }
}
