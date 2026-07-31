const SOURCE = 'https://thegivingblock.com/resources/nonprofits-accepting-crypto-donations/';
const MAX_AGE = 'public, s-maxage=21600, stale-while-revalidate=86400';

function decode(value = '') {
  return value.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#8217;/g, '\u2019')
    .replace(/&#8211;/g, '\u2013').replace(/&#038;/g, '&').trim();
}

export default async function handler(_req, res) {
  try {
    const upstream = await fetch(SOURCE, { headers: { 'User-Agent': 'RWIhood directory refresh' } });
    if (!upstream.ok) throw new Error(`Directory returned ${upstream.status}`);
    const html = await upstream.text();
    const entries = [];
    const seen = new Set();
    const card = /<div\s+class="col-md-6[\s\S]*?<h4\s+class="pt-cv-title"><a\s+href=([^\s>]+)[^>]*>([\s\S]*?)<\/a><\/h4>/gi;
    let match;
    while ((match = card.exec(html))) {
      const href = decode(match[1].replace(/["']/g, ''));
      const slug = (href.match(/\/donate\/([^/?#]+)/i) || [])[1];
      const name = decode(match[2].replace(/<[^>]*>/g, ''));
      const start = Math.max(0, match.index - 1300);
      const fragment = html.slice(start, match.index + 200);
      const image = (fragment.match(/<img[^>]+src=([^\s>]+)/i) || [])[1] || '';
      if (slug && name && !seen.has(slug)) {
        seen.add(slug);
        entries.push([slug, name, decode(image.replace(/["']/g, ''))]);
      }
    }
    entries.sort((a, b) => a[1].localeCompare(b[1]));
    res.setHeader('Cache-Control', MAX_AGE);
    res.status(200).json({ source: SOURCE, updatedAt: new Date().toISOString(), organizations: entries });
  } catch (error) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: 'Unable to refresh the public directory.' });
  }
}
