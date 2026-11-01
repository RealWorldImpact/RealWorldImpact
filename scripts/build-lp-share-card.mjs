import sharp from 'sharp';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

// Render at 2x before reducing so the fine orbit lines and type stay crisp.
// Use the site's original logo, rather than recreating the RWI lettering.
const output = new URL('../assets/share/og-lp-v1.png', import.meta.url);
const logo = await sharp(fileURLToPath(new URL('../assets/rwi-logo.webp', import.meta.url)))
  .png().toBuffer();
const svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="halo">
      <stop offset="0" stop-color="#ccfe06" stop-opacity=".13"/>
      <stop offset="1" stop-color="#ccfe06" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="orbit" x1="0" y1="1" x2="1" y2="0">
      <stop stop-color="#ccfe06" stop-opacity=".1"/>
      <stop offset=".55" stop-color="#ccfe06" stop-opacity=".7"/>
      <stop offset="1" stop-color="#ccfe06" stop-opacity=".22"/>
    </linearGradient>
    <pattern id="grid" width="42" height="42" patternUnits="userSpaceOnUse">
      <path d="M42 0H0V42" fill="none" stroke="#b5c5a7" stroke-opacity=".045"/>
    </pattern>
    <clipPath id="logoCircle"><circle cx="887" cy="302" r="108"/></clipPath>
  </defs>
  <rect width="1200" height="630" fill="#0b0d09"/>
  <rect x="600" y="102" width="600" height="426" fill="url(#grid)"/>
  <circle cx="887" cy="302" r="280" fill="url(#halo)"/>
  <path d="M64 96H1136M64 538H1136" stroke="#303829"/>
  <path d="M64 96H126" stroke="#ccfe06" stroke-width="3"/>

  <text x="64" y="60" fill="#f1f2e9" font-family="Courier New,monospace" font-size="21" letter-spacing="2">REAL WORLD IMPACT</text>
  <text x="1136" y="60" text-anchor="end" fill="#a4af98" font-family="Courier New,monospace" font-size="16" letter-spacing="1.5">LAUNCH / LIQUIDITY / PROFILE</text>

  <text x="56" y="343" fill="#ccfe06" font-family="Georgia,serif" font-size="278" font-weight="bold" letter-spacing="-18">LP</text>
  <g fill="#f1f2e9" font-family="Arial,sans-serif" font-size="43" letter-spacing="-1.3">
    <text x="66" y="416">Launch tokens.</text>
    <text x="66" y="468">Build liquidity.</text>
  </g>

  <g fill="none">
    <circle cx="887" cy="302" r="176" stroke="#70864b" stroke-opacity=".27"/>
    <circle cx="887" cy="302" r="210" stroke="#70864b" stroke-opacity=".13" stroke-dasharray="2 10"/>
    <ellipse cx="887" cy="302" rx="258" ry="105" transform="rotate(-29 887 302)" stroke="url(#orbit)" stroke-width="2"/>
    <ellipse cx="887" cy="302" rx="231" ry="133" transform="rotate(37 887 302)" stroke="#8ba451" stroke-opacity=".32"/>
    <path d="M887 126V141M887 463V478M711 302H726M1048 302H1063" stroke="#d2e2bc" stroke-opacity=".5"/>
  </g>
  <circle cx="887" cy="302" r="120" fill="#0b0d09" stroke="#ccfe06" stroke-opacity=".4"/>
  <image x="779" y="194" width="216" height="216" clip-path="url(#logoCircle)" xlink:href="data:image/png;base64,${logo.toString('base64')}"/>
  <g fill="#0b0d09" stroke="#c5f23b" stroke-width="1.5">
    <circle cx="676" cy="411" r="25"/>
    <circle cx="1098" cy="193" r="25"/>
    <circle cx="1038" cy="448" r="18" stroke="#82965b"/>
  </g>
  <path d="M665 411H687M676 400V422" stroke="#ccfe06" stroke-width="2"/>
  <path d="M1098 182L1109 193L1098 204L1087 193Z" fill="none" stroke="#ccfe06" stroke-width="2"/>
  <circle cx="1038" cy="448" r="5" fill="#ccfe06"/>
  <circle cx="753" cy="176" r="4" fill="#ccfe06"/>
  <circle cx="941" cy="472" r="3" fill="#a9c87d"/>

  <text x="64" y="584" fill="#ccfe06" font-family="Courier New,monospace" font-size="22" letter-spacing=".2">RWIhood.org/LP</text>
  <text x="1136" y="583" text-anchor="end" fill="#a4af98" font-family="Courier New,monospace" font-size="18" letter-spacing=".5">UNISWAP v4 · ROBINHOOD CHAIN</text>
</svg>`;

const png = await sharp(Buffer.from(svg), { density: 144 })
  .resize(1200, 630).flatten({ background: '#0b0d09' })
  .png({ compressionLevel: 9 }).toBuffer();
await writeFile(output, png);
console.log(`LP share card: 1200 x 630, ${Math.round(png.length / 1024)} KB`);
