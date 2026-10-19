const TOKEN = '0xda2598c976e62e7e15dcca75169b404712e48b04';
const POOL = '0xa72a9de2c6e3db34308a8ae61e927ceffea630218ca1e712b70b61341c3e99a1';
const BASE = `https://api.geckoterminal.com/api/v2/networks/robinhood/pools/${POOL}/ohlcv/minute`;
const cache = new Map();

// Round up the fixed $5 quote to whole base units without floating-point loss.
export function unitsForPrice(price) {
  const match = String(price).toLowerCase().match(/^(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/);
  if (!match) throw new Error('Invalid historical price');
  const digits = BigInt(match[1] + (match[2] || ''));
  const exponent = Number(match[3] || 0) - (match[2] || '').length;
  if (digits <= 0n || Math.abs(exponent) > 100) throw new Error('Invalid historical price');
  let numerator = 5n * 10n ** 18n, denominator = digits;
  if (exponent < 0) numerator *= 10n ** BigInt(-exponent);
  else denominator *= 10n ** BigInt(exponent);
  return ((numerator + denominator - 1n) / denominator).toString();
}

export async function quoteAt(at, fetcher = fetch) {
  const url = new URL(BASE);
  url.search = new URLSearchParams({ aggregate:'1', before_timestamp:String(at), limit:'10', currency:'usd', token:TOKEN, include_empty_intervals:'true' });
  const response = await fetcher(url, { headers:{accept:'application/json'}, signal:AbortSignal.timeout(7000) });
  if (!response.ok) throw new Error('Historical price unavailable');
  const body = await response.json();
  if (body.meta?.base?.address?.toLowerCase() !== TOKEN) throw new Error('Wrong quote token');
  const candles = body.data?.attributes?.ohlcv_list;
  if (!Array.isArray(candles)) throw new Error('Invalid historical prices');
  // Never use a candle that is still forming, even if an upstream ignores the cutoff.
  const candle = candles.filter(c => Number.isInteger(c[0]) && c[0] + 60 <= at && Number(c[4]) > 0)
    .sort((a,b) => b[0] - a[0])[0];
  if (!candle) throw new Error('No completed historical candle');
  return { quoteAt:at, candleAt:candle[0], priceUsd:String(candle[4]), units:unitsForPrice(candle[4]), token:TOKEN, pool:POOL, usd:5 };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({error:'Method not allowed'});
  const now = Math.floor(Date.now() / 1000);
  // Allow two minutes for price indexing before issuing a new quote.
  const at = req.query.at === undefined ? Math.floor(now / 60) * 60 - 120 : Number(req.query.at);
  if (!Number.isSafeInteger(at) || at % 60 !== 0 || at < 1788472980 || at > Math.floor(now / 60) * 60 - 60) {
    return res.status(400).json({error:'Invalid fee quote time'});
  }
  try {
    let quote = cache.get(at);
    if (!quote) {
      quote = await quoteAt(at);
      if (cache.size >= 500) cache.delete(cache.keys().next().value);
      cache.set(at, quote);
    }
    res.setHeader('Cache-Control', req.query.at === undefined ? 'public, s-maxage=15' : 'public, max-age=31536000, immutable');
    return res.status(200).json(quote);
  } catch {
    res.setHeader('Cache-Control','no-store');
    return res.status(502).json({error:'The original fee quote could not be verified. Please retry.'});
  }
}
