const INDEXER_URL = 'https://indices.theindex.finance/api/indexer';
const GECKO_TOKEN_URL = 'https://api.geckoterminal.com/api/v2/networks/robinhood/tokens/';
const TREASURY = '0xb2c088db84293a6e3dee0765596f1cfdc2b9334d';
const TOKEN = '0xda2598c976e62e7e15dcca75169b404712e48b04';
const ASSETS = {
  '0x0000000000000000000000000000000000000001': 'BURN',
  '0x0000000000000000000000000000000000000002': 'LIQUIDITY',
  '0x56910d4409f3a0c78c64dd8d0545ff0705389870': 'INDEX',
  '0x39dbed3a2bd333467115de45665cc57f813c4571': 'PONS',
};
const PRICE_ASSETS = {
  RWI: TOKEN,
  INDEX: '0x56910d4409f3a0c78c64dd8d0545ff0705389870',
  PONS: '0x39dbed3a2bd333467115de45665cc57f813c4571',
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

function toUsdValue(amount, priceUsd) {
  const tokenAmount = Number(amount);
  if (tokenAmount === 0) return '0';
  if (priceUsd === null || priceUsd === undefined || priceUsd === '') return null;
  const total = tokenAmount * Number(priceUsd);
  return Number.isFinite(total) ? String(total) : null;
}

async function fetchPricesUsd() {
  const entries = await Promise.all(Object.entries(PRICE_ASSETS).map(async ([symbol, address]) => {
    try {
      const response = await fetch(`${GECKO_TOKEN_URL}${address}`, {
        headers: { accept: 'application/json' },
        signal: AbortSignal.timeout(8_000),
      });
      if (!response.ok) return [symbol, null];
      const body = await response.json();
      const price = body?.data?.attributes?.price_usd;
      const numericPrice = Number(price);
      return [symbol, price !== null && price !== undefined && price !== '' && Number.isFinite(numericPrice)
        ? String(price)
        : null];
    } catch {
      return [symbol, null];
    }
  }));
  return Object.fromEntries(entries);
}

function buildPayload(body, pricesUsd) {
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

  const paidBySymbol = new Map((body?.data?.treasuryAssets?.items || []).map(item => {
    const raw = BigInt(item.totalPaid || '0') + BigInt(item.totalSwept || '0');
    return [ASSETS[String(item.asset).toLowerCase()] || 'UNKNOWN', formatUnits(raw)];
  }));
  const distributed = ['INDEX', 'PONS'].map(symbol => {
    const amount = paidBySymbol.get(symbol) || '0';
    return {
      symbol,
      amount,
      priceUsd: pricesUsd[symbol],
      usdValue: toUsdValue(amount, pricesUsd[symbol]),
    };
  });
  const rwiBurned = formatUnits(treasury.burned);

  return {
    source: `https://indices.theindex.finance/coin/${TREASURY}`,
    treasury: TREASURY,
    token: TOKEN,
    allocation,
    distributed,
    pricesUsd,
    rwiBurned,
    rwiBurnedUsd: toUsdValue(rwiBurned, pricesUsd.RWI),
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

    const pricesUsd = await fetchPricesUsd();
    const payload = buildPayload(body, pricesUsd);
    cached = { timestamp: Date.now(), body: payload };
    res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
    return res.status(200).json(payload);
  } catch {
    return res.status(502).json({ error: 'The Index rewards feed is temporarily unavailable' });
  }
}
