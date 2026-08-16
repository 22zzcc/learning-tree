import { STATE_COLOR, STATE_LABEL } from '../types'

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 3000)
}

function prepareClone(svg: SVGSVGElement): SVGSVGElement {
  const clone = svg.cloneNode(true) as SVGSVGElement
  const zoomG = clone.querySelector('g.zoom-group')
  if (zoomG) zoomG.setAttribute('transform', '')
  const content = clone.querySelector('g.content-group') as SVGGElement | null
  if (!content) return clone
  const bbox = content.getBBox()
  const pad = 80
  const w = Math.ceil(bbox.width + pad * 2)
  const h = Math.ceil(bbox.height + pad * 2)
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(w))
  clone.setAttribute('height', String(h))
  clone.setAttribute('viewBox', [bbox.x - pad, bbox.y - pad, w, h].join(' '))

  // 白色背景
  const bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  bg.setAttribute('x', String(bbox.x - pad))
  bg.setAttribute('y', String(bbox.y - pad))
  bg.setAttribute('width', String(w))
  bg.setAttribute('height', String(h))
  bg.setAttribute('fill', '#ffffff')
  clone.insertBefore(bg, clone.firstChild)

  // 图例
  const legend = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  legend.setAttribute('class', 'export-legend')
  const items = [
    { key: 'mastered', label: STATE_LABEL.mastered },
    { key: 'learning', label: STATE_LABEL.learning },
    { key: 'fuzzy', label: STATE_LABEL.fuzzy },
    { key: 'unlearned', label: STATE_LABEL.unlearned }
  ] as const
  let lx = bbox.x
  const ly = bbox.y + bbox.height + pad - 26
  items.forEach((it) => {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    circle.setAttribute('cx', String(lx))
    circle.setAttribute('cy', String(ly))
    circle.setAttribute('r', '6')
    circle.setAttribute('fill', STATE_COLOR[it.key])
    legend.appendChild(circle)
    const text = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    text.setAttribute('x', String(lx + 12))
    text.setAttribute('y', String(ly + 4))
    text.setAttribute('font-size', '14')
    text.setAttribute('fill', '#4a5a53')
    text.textContent = it.label
    legend.appendChild(text)
    lx += 110
  })
  clone.appendChild(legend)
  return clone
}

export function exportSvg(svg: SVGSVGElement, filename: string) {
  const clone = prepareClone(svg)
  const str = new XMLSerializer().serializeToString(clone)
  downloadBlob(new Blob([str], { type: 'image/svg+xml;charset=utf-8' }), filename)
}

export async function exportPng(svg: SVGSVGElement, filename: string) {
  const clone = prepareClone(svg)
  const str = new XMLSerializer().serializeToString(clone)
  const blob = new Blob([str], { type: 'image/svg+xml;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const img = new Image()
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve()
    img.onerror = () => reject(new Error('SVG 转图片失败'))
    img.src = url
  })
  const scale = 2
  const canvas = document.createElement('canvas')
  canvas.width = img.width * scale
  canvas.height = img.height * scale
  const ctx = canvas.getContext('2d')!
  ctx.scale(scale, scale)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, img.width, img.height)
  ctx.drawImage(img, 0, 0)
  URL.revokeObjectURL(url)
  const pngBlob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/png'))
  if (pngBlob) downloadBlob(pngBlob, filename)
}
