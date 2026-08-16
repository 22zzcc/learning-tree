// 极简 PNG 解码 + 像素统计（纯 Node，仅支持 8bit RGB/RGBA 非隔行）
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

const file = process.argv[2]
const buf = readFileSync(file)
if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a png')

let pos = 8
let width = 0, height = 0, bitDepth = 0, colorType = 0
const idat = []
while (pos < buf.length) {
  const len = buf.readUInt32BE(pos)
  const type = buf.toString('ascii', pos + 4, pos + 8)
  const data = buf.subarray(pos + 8, pos + 8 + len)
  if (type === 'IHDR') {
    width = data.readUInt32BE(0)
    height = data.readUInt32BE(4)
    bitDepth = data[8]
    colorType = data[9]
  } else if (type === 'IDAT') {
    idat.push(data)
  }
  pos += 12 + len
}
const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : 0
if (channels === 0 || bitDepth !== 8) throw new Error('unsupported png: bitDepth=' + bitDepth + ' colorType=' + colorType)
const raw = inflateSync(Buffer.concat(idat))
const stride = width * channels
const out = Buffer.alloc(height * stride)
for (let y = 0; y < height; y++) {
  const filter = raw[y * (stride + 1)]
  const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
  const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null
  const cur = out.subarray(y * stride, (y + 1) * stride)
  for (let i = 0; i < stride; i++) {
    const a = i >= channels ? cur[i - channels] : 0
    const b = prev ? prev[i] : 0
    const c = i >= channels && prev ? prev[i - channels] : 0
    let v = line[i]
    if (filter === 1) v = (v + a) & 0xff
    else if (filter === 2) v = (v + b) & 0xff
    else if (filter === 3) v = (v + ((a + b) >> 1)) & 0xff
    else if (filter === 4) {
      const p = a + b - c
      const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c)
      const pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      v = (v + pr) & 0xff
    }
    cur[i] = v
  }
}

// 统计
const colorCount = new Map()
let nonWhite = 0, total = 0
const target = { r: 0x2e, g: 0x7d, b: 0x5b } // 主题绿
let targetHits = 0
for (let i = 0; i < out.length; i += channels) {
  const r = out[i], g = out[i + 1], b = out[i + 2]
  total++
  const key = (r << 16) | (g << 8) | b
  colorCount.set(key, (colorCount.get(key) || 0) + 1)
  if (r < 245 || g < 245 || b < 245) nonWhite++
  if (Math.abs(r - target.r) < 30 && Math.abs(g - target.g) < 30 && Math.abs(b - target.b) < 30) targetHits++
}
const top = [...colorCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  .map(([k, n]) => '#' + k.toString(16).padStart(6, '0') + ' ' + (100 * n / total).toFixed(1) + '%')
console.log('size:', width + 'x' + height, '| unique colors:', colorCount.size)
console.log('non-white pixels:', (100 * nonWhite / total).toFixed(2) + '%', '| theme-green pixels:', targetHits)
console.log('top colors:', top.join('  '))
