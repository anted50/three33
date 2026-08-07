import { readFileSync } from 'node:fs'
import sharp from 'sharp'

const src = 'C:/Users/Anted/Downloads/ascii-image-phosphor-halo.txt'
const out = process.argv[2]

const lines = readFileSync(src, 'utf8').replace(/\r/g, '').split('\n')
const cols = Math.max(...lines.map((l) => l.length))

const SIZE = 8
const W = Math.round(cols * SIZE * 0.6)
const H = lines.length * SIZE

const text = lines
  .map(
    (l, i) =>
      `<text xml:space="preserve" x="0" y="${(i + 1) * SIZE}">${l
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')}</text>`,
  )
  .join('')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
<rect width="${W}" height="${H}" fill="#0b0b0b"/>
<g font-family="monospace" font-size="${SIZE}" fill="#ffffff">${text}</g>
</svg>`

await sharp(Buffer.from(svg)).resize(1000).png().toFile(`${out}/halo.png`)
console.log(`${cols} cols x ${lines.length} rows -> ${W}x${H}`)
