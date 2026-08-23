// One-off: rasterizes the Three33 mark (see src/components/logo.tsx) plus a
// wordmark into a small PNG for the receipt email — inline SVG is unreliable
// across email clients (Outlook desktop drops it entirely), so this bakes a
// static image once instead of computing one per send.
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'

const INK = '#0a0a0a'

const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="1400" height="300">
  <g transform="translate(20,58) scale(0.55)">
    <circle cx="166" cy="167" r="157.5" fill="none" stroke="${INK}" stroke-width="20"/>
    <circle cx="531.5" cy="167" r="167" fill="${INK}"/>
    <circle cx="897" cy="167" r="157.5" fill="none" stroke="${INK}" stroke-width="20"/>
  </g>
  <text x="660" y="195" font-family="Arial, Helvetica, sans-serif" font-size="128" font-weight="800" letter-spacing="10" fill="${INK}">THREE 33</text>
</svg>
`

const png = await sharp(Buffer.from(svg))
  .trim()
  .resize({ height: 96 })
  .png()
  .toBuffer()

const meta = await sharp(png).metadata()
writeFileSync('public/email-logo.png', png)
console.log(`wrote public/email-logo.png — ${meta.width}x${meta.height}, ${png.length} bytes`)
