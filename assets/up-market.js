// Combined RWI liquidity and rolling 24-hour volume from Up's public pool indexers.
(() => {
  const rwi = '0xda2598c976e62e7e15dcca75169b404712e48b04';
  const up = '0x57c0e45cb534413d1c20a4240955d6bb250bb4f1';
  const weth = '0x0bd7d308f8e1639fab988df18a8011f41eacad73';
  const root = 'https://api.goldsky.com/api/public/project_cmhef02640198x7p2cz2w70u8/subgraphs/';
  const v2Url = `${root}up-robinhood-v2-mainnet/0.1.0/gn`;
  const v3Url = `${root}up-robinhood-v3-mainnet/0.1.1/gn`;
  const pricesUrl = `https://api.dexscreener.com/tokens/v1/robinhood/${rwi},${up},${weth}`;
  const currency = new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2,
  });

  function amount(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 && number < 1e15 ? number : 0;
  }

  async function graph(url, query, signal) {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query }),
      signal,
    });
    if (!response.ok) throw new Error(`Up indexer returned ${response.status}`);
    const result = await response.json();
    if (!result.data || result.errors?.length) throw new Error('Up indexer returned incomplete data');
    return result.data;
  }

  async function tokenPrices(signal) {
    const response = await fetch(pricesUrl, { signal });
    if (!response.ok) throw new Error(`Price feed returned ${response.status}`);
    const pairs = await response.json();
    if (!Array.isArray(pairs)) throw new Error('Price feed returned incomplete data');
    const best = new Map();
    for (const pair of pairs) {
      if (pair.chainId !== 'robinhood') continue;
      const address = pair.baseToken?.address?.toLowerCase();
      const price = amount(pair.priceUsd);
      const liquidity = amount(pair.liquidity?.usd);
      if (!address || !price || !liquidity) continue;
      if (!best.has(address) || liquidity > best.get(address).liquidity) {
        best.set(address, { price, liquidity });
      }
    }
    return new Map([...best].map(([address, value]) => [address, value.price]));
  }

  function valuedSides(token0, token1, amount0, amount1, prices) {
    const values = [];
    for (const [token, units] of [[token0, amount0], [token1, amount1]]) {
      const price = prices.get(token?.id?.toLowerCase());
      if (price && amount(units)) values.push(amount(units) * price);
    }
    return values;
  }

  function usdVolume(pool, indexedUsd, token0Volume, token1Volume, prices) {
    const indexed = amount(indexedUsd);
    if (indexed) return indexed;
    const sides = valuedSides(pool.token0, pool.token1, token0Volume, token1Volume, prices);
    if (sides.length) return sides.reduce((sum, value) => sum + value, 0) / sides.length;
    if (amount(token0Volume) || amount(token1Volume)) throw new Error('USD price unavailable');
    return 0;
  }

  function usdLiquidity(pool, indexedUsd, token0Reserve, token1Reserve, prices) {
    const sides = valuedSides(pool.token0, pool.token1, token0Reserve, token1Reserve, prices);
    return Math.max(amount(indexedUsd), sides.reduce((sum, value) => sum + value, 0));
  }

  async function v2Pools(signal) {
    const fields = 'id token0 { id } token1 { id } reserve0 reserve1 reserveUSD';
    const query = `query {
      token0Pairs: pairs(first: 1000, where: {token0: "${rwi}"}) { ${fields} }
      token1Pairs: pairs(first: 1000, where: {token1: "${rwi}"}) { ${fields} }
    }`;
    const data = await graph(v2Url, query, signal);
    if (!Array.isArray(data.token0Pairs) || !Array.isArray(data.token1Pairs) ||
        data.token0Pairs.length === 1000 || data.token1Pairs.length === 1000) {
      throw new Error('Up v2 pool list incomplete');
    }
    return [...new Map([...data.token0Pairs, ...data.token1Pairs].map(pool => [pool.id.toLowerCase(), pool])).values()];
  }

  async function v2Hours(pools, since, signal) {
    const ids = pools.map(pool => pool.id.toLowerCase());
    if (!ids.every(id => /^0x[0-9a-f]{40}$/.test(id))) throw new Error('Invalid Up pool address');
    if (!ids.length) return new Map();
    const totals = new Map();
    for (let page = 0; page < 10; page += 1) {
      const query = `query {
        pairHourDatas(
          first: 1000, skip: ${page * 1000},
          orderBy: hourStartUnix, orderDirection: desc,
          where: {hourStartUnix_gte: ${since}, pair_in: [${ids.map(id => `"${id}"`).join(',')}]}
        ) { pair { id } hourlyVolumeUSD hourlyVolumeToken0 hourlyVolumeToken1 }
      }`;
      const rows = (await graph(v2Url, query, signal)).pairHourDatas;
      if (!Array.isArray(rows)) throw new Error('Up v2 volume incomplete');
      for (const row of rows) {
        const id = row.pair?.id?.toLowerCase();
        if (!ids.includes(id)) continue;
        const total = totals.get(id) || { usd: 0, token0: 0, token1: 0 };
        total.usd += amount(row.hourlyVolumeUSD);
        total.token0 += amount(row.hourlyVolumeToken0);
        total.token1 += amount(row.hourlyVolumeToken1);
        totals.set(id, total);
      }
      if (rows.length < 1000) return totals;
    }
    throw new Error('Up v2 volume exceeded pagination limit');
  }

  async function v3Pools(since, signal) {
    const fields = `id token0 { id } token1 { id }
      totalValueLockedUSD totalValueLockedToken0 totalValueLockedToken1
      poolHourData(first: 24, orderBy: periodStartUnix, orderDirection: desc,
        where: {periodStartUnix_gte: ${since}}) {
        volumeUSD volumeToken0 volumeToken1
      }`;
    const query = `query {
      token0Pools: pools(first: 1000, where: {token0: "${rwi}"}) { ${fields} }
      token1Pools: pools(first: 1000, where: {token1: "${rwi}"}) { ${fields} }
    }`;
    const data = await graph(v3Url, query, signal);
    if (!Array.isArray(data.token0Pools) || !Array.isArray(data.token1Pools) ||
        data.token0Pools.length === 1000 || data.token1Pools.length === 1000) {
      throw new Error('Up v3 pool list incomplete');
    }
    return [...new Map([...data.token0Pools, ...data.token1Pools].map(pool => [pool.id.toLowerCase(), pool])).values()];
  }

  function setStatus(element, key, fallback) {
    element.setAttribute('data-i18n', key);
    element.textContent = typeof window.t === 'function' ? window.t(key) : fallback;
  }

  function init() {
    const liquidity = document.getElementById('upRwiLiquidity');
    const volume = document.getElementById('upRwiVolume');
    const status = document.getElementById('upRwiStatus');
    if (!liquidity || !volume || !status) return;
    let loading = false;

    async function refresh() {
      if (loading) return;
      loading = true;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000);
      try {
        const since = Math.floor(Date.now() / 1000) - 86400;
        const [v2, v3, prices] = await Promise.all([
          v2Pools(controller.signal), v3Pools(since, controller.signal), tokenPrices(controller.signal),
        ]);
        if (!v2.length && !v3.length) throw new Error('No RWI pools indexed on Up');
        const hours = await v2Hours(v2, since, controller.signal);
        let totalLiquidity = 0;
        let totalVolume = 0;
        for (const pool of v2) {
          const hour = hours.get(pool.id.toLowerCase()) || { usd: 0, token0: 0, token1: 0 };
          totalLiquidity += usdLiquidity(pool, pool.reserveUSD, pool.reserve0, pool.reserve1, prices);
          totalVolume += usdVolume(pool, hour.usd, hour.token0, hour.token1, prices);
        }
        for (const pool of v3) {
          const hour = (pool.poolHourData || []).reduce((sum, row) => ({
            usd: sum.usd + amount(row.volumeUSD),
            token0: sum.token0 + amount(row.volumeToken0),
            token1: sum.token1 + amount(row.volumeToken1),
          }), { usd: 0, token0: 0, token1: 0 });
          totalLiquidity += usdLiquidity(pool, pool.totalValueLockedUSD,
            pool.totalValueLockedToken0, pool.totalValueLockedToken1, prices);
          totalVolume += usdVolume(pool, hour.usd, hour.token0, hour.token1, prices);
        }
        liquidity.textContent = currency.format(totalLiquidity);
        volume.textContent = currency.format(totalVolume);
        setStatus(status, 'index.liquidity.live', 'Live from Up');
      } catch (error) {
        liquidity.textContent = '—';
        volume.textContent = '—';
        setStatus(status, 'index.liquidity.unavailable', 'Live totals unavailable');
        console.warn('Up liquidity totals unavailable', error);
      } finally {
        clearTimeout(timeout);
        loading = false;
      }
    }

    refresh();
    setInterval(() => { if (!document.hidden) refresh(); }, 120000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
