// ---------- 纯渲染函数：把 TreeNode 数据画成「章节式」垂直知识树 ----------
// 布局像一本书的目录：目标(书名) → 大类(竖排) → 章(1.1) → 节(1.1.1)，整体窄而深。

import * as d3 from 'd3'
import type { TreeNode } from '../types'
import { STATE_COLOR, STATE_BG, STATE_LABEL } from '../types'

export const ROOT_W = 190
export const ROOT_H = 56
export const V_W = 48           // 第一层大类：竖向卡片宽度
export const H_W = 160          // 章/节卡片宽度
export const H_H = 50
export const DX = 190           // 同级水平间距（窄）
export const DY = 170           // 层间垂直间距

export function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + '…' : s
}

export function wrapName(name: string): string[] {
  if (name.length <= 13) return [name]
  const mid = Math.ceil(name.length / 2)
  let second = name.slice(mid)
  if (second.length > 13) second = second.slice(0, 12) + '…'
  return [name.slice(0, mid), second]
}

function cardSize(d: d3.HierarchyPointNode<TreeNode>): { w: number; h: number } {
  if (d.depth === 0) return { w: ROOT_W, h: ROOT_H }
  if (d.depth === 1) {
    const chars = [...d.data.name]
    const shown = Math.min(chars.length, 12)
    return { w: V_W, h: Math.max(84, shown * 16 + 44) }
  }
  return { w: H_W, h: H_H }
}

export interface RenderTreeOpts {
  svgEl: SVGSVGElement
  root: TreeNode
  childrenMap: Map<string, TreeNode[]>
  collapsed: Set<string>
  selectedId: string | null
  transform: d3.ZoomTransform
  /** true 时忽略 transform，重新按根节点居中布局（重置/聚焦） */
  fitRoot?: boolean
  onSelect: (id: string) => void
  onToggleCollapse: (id: string) => void
  onFocus: (id: string) => void
  onBackgroundClick: () => void
  onTransformChange: (t: d3.ZoomTransform) => void
}

export function renderTree(opts: RenderTreeOpts): void {
  const {
    svgEl,
    root,
    childrenMap,
    collapsed,
    selectedId,
    onSelect,
    onToggleCollapse,
    onFocus,
    onBackgroundClick,
    onTransformChange
  } = opts

  const childrenOf = (n: TreeNode): TreeNode[] => {
    if (collapsed.has(n.id)) return []
    return childrenMap.get(n.id) ?? []
  }
  const hierarchy = d3.hierarchy(root, (d) => childrenOf(d))
  const layout = d3.tree<TreeNode>().nodeSize([DX, DY])
  const rootD3 = layout(hierarchy)

  // 章节编号：根为空，第一层 = 1/2/3，往下 = 1.1 / 1.1.1 …
  rootD3.each((d: d3.HierarchyPointNode<TreeNode> & { num?: string }) => {
    if (d.depth === 0) {
      d.num = ''
      return
    }
    const idx = (d.parent?.children?.indexOf(d) ?? 0) + 1
    d.num = (d.parent && (d.parent as any).num ? (d.parent as any).num + '.' : '') + idx
  })

  let minX = Infinity
  let maxX = -Infinity
  let maxY = 0
  rootD3.descendants().forEach((d) => {
    minX = Math.min(minX, d.x)
    maxX = Math.max(maxX, d.x)
    maxY = Math.max(maxY, d.y)
  })
  const width = Math.max(800, maxX - minX + DX)
  const height = Math.max(560, maxY + 140)

  const svg = d3.select(svgEl)
  svg.selectAll('*').remove()
  svg.attr('viewBox', '0 0 ' + width + ' ' + height)

  // 阴影滤镜
  const defs = svg.append('defs')
  const filter = defs
    .append('filter')
    .attr('id', 'card-shadow')
    .attr('x', '-40%')
    .attr('y', '-40%')
    .attr('width', '180%')
    .attr('height', '180%')
  filter
    .append('feDropShadow')
    .attr('dx', 0)
    .attr('dy', 2)
    .attr('stdDeviation', 4)
    .attr('flood-color', '#1e3c2d')
    .attr('flood-opacity', 0.14)

  const zoomG = svg.append('g').attr('class', 'zoom-group')
  const content = zoomG.append('g').attr('class', 'content-group')

  const initialTransform = d3.zoomIdentity.translate(width / 2 - rootD3.x, 70)
  const t = opts.fitRoot ? initialTransform : opts.transform
  zoomG.attr('transform', t.toString())
  onTransformChange(t)

  const zoom = d3
    .zoom<SVGSVGElement, unknown>()
    .scaleExtent([0.15, 3])
    .on('zoom', (event) => {
      zoomG.attr('transform', event.transform.toString())
      onTransformChange(event.transform)
    })
  svg.call(zoom).call(zoom.transform, t)

  // ---- 边 ----
  const link = d3
    .linkVertical<d3.HierarchyPointLink<TreeNode>, d3.HierarchyPointNode<TreeNode>>()
    .x((d) => d.x)
    .y((d) => d.y)

  const linkG = content.append('g').attr('class', 'links')
  rootD3.links().forEach((l) => {
    const lit = l.target.data.edgeLit
    linkG
      .append('path')
      .attr('class', 'link' + (lit ? ' lit' : ''))
      .attr('d', link(l))
      .attr('fill', 'none')
      .attr('stroke', lit ? '#2e9e5b' : '#c6d2cc')
      .attr('stroke-width', lit ? 2 : 1.5)
      .attr('stroke-dasharray', lit ? 'none' : '5 5')
    if (lit && l.target.data.edgeWhy) {
      const mx = (l.source.x + l.target.x) / 2
      const my = (l.source.y + l.target.y) / 2
      const label = linkG
        .append('text')
        .attr('class', 'edge-label')
        .attr('x', mx)
        .attr('y', my - 3)
        .attr('text-anchor', 'middle')
        .attr('font-size', 10)
        .attr('fill', '#2e7d5b')
        .attr('paint-order', 'stroke')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 4)
        .attr('stroke-linejoin', 'round')
        .style('cursor', 'pointer')
        .text(truncate(l.target.data.edgeWhy, 14))
        .on('click', (event) => {
          event.stopPropagation()
          onSelect(l.target.data.id)
        })
      label.append('title').text(l.target.data.edgeWhy ?? '')
    }
  })

  // ---- 节点 ----
  const nodeG = content.append('g').attr('class', 'nodes')
  const g = nodeG
    .selectAll('g.node')
    .data(rootD3.descendants())
    .join('g')
    .attr('class', 'node')
    .attr('transform', (d) => 'translate(' + d.x + ',' + d.y + ')')

  g.each(function (d) {
    drawCard(d3.select(this), d as d3.HierarchyPointNode<TreeNode> & { num?: string })
  })

  // 折叠按钮（有子节点时显示在卡片底边）
  const withKids = g.filter((d) => (childrenMap.get(d.data.id)?.length ?? 0) > 0)
  withKids
    .append('circle')
    .attr('class', 'collapse-toggle')
    .attr('cx', 0)
    .attr('cy', (d) => cardSize(d).h / 2)
    .attr('r', 9)
    .attr('fill', '#ffffff')
    .attr('stroke', '#b8c4c0')
    .style('cursor', 'pointer')
    .on('click', (event, d) => {
      event.stopPropagation()
      onToggleCollapse(d.data.id)
    })
  withKids
    .append('text')
    .attr('x', 0)
    .attr('y', (d) => cardSize(d).h / 2 + 3)
    .attr('text-anchor', 'middle')
    .attr('font-size', 11)
    .attr('fill', '#68766f')
    .style('cursor', 'pointer')
    .text((d) => (collapsed.has(d.data.id) ? '+' : '−'))
    .on('click', (event, d) => {
      event.stopPropagation()
      onToggleCollapse(d.data.id)
    })

  g.on('click', (event, d) => {
    onSelect(d.data.id)
  })
    .on('dblclick', (event, d) => {
      event.stopPropagation()
      onFocus(d.data.id)
    })
    .append('title')
    .text((d) => d.data.name + '｜' + STATE_LABEL[d.data.state] + '｜双击聚焦')

  // 点击空白处取消选中
  svg.on('click', function (event) {
    if (event.target === this) onBackgroundClick()
  })

  // ---- 卡片绘制（章节式：大类竖排 + 章/节带编号） ----
  function drawCard(el: d3.Selection<any, any, any, any>, d: d3.HierarchyPointNode<TreeNode> & { num?: string }) {
    const { w, h } = cardSize(d)
    const selected = d.data.id === selectedId
    el.append('rect')
      .attr('x', -w / 2)
      .attr('y', -h / 2)
      .attr('width', w)
      .attr('height', h)
      .attr('rx', 10)
      .attr('fill', STATE_BG[d.data.state])
      .attr('stroke', selected ? '#2e7d5b' : STATE_COLOR[d.data.state])
      .attr('stroke-width', selected ? 3 : 1.5)
      .attr('filter', 'url(#card-shadow)')
      .style('cursor', 'pointer')

    if (d.depth === 1) {
      // 大类：文字竖排 + 顶部编号
      el.append('text')
        .attr('x', 0)
        .attr('y', -h / 2 + 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', 10)
        .attr('font-weight', 700)
        .attr('fill', '#68766f')
        .text(d.num ?? '')
      const chars = [...d.data.name]
      const shown = chars.length > 12 ? [...chars.slice(0, 11), '…'] : chars
      shown.forEach((ch, i) => {
        el.append('text')
          .attr('x', 0)
          .attr('y', -h / 2 + 32 + i * 16)
          .attr('text-anchor', 'middle')
          .attr('font-size', 14)
          .attr('font-weight', 600)
          .attr('fill', '#243b33')
          .text(ch)
      })
      el.append('circle')
        .attr('class', 'state-dot')
        .attr('cx', 0)
        .attr('cy', h / 2 - 14)
        .attr('r', 5)
        .attr('fill', STATE_COLOR[d.data.state])
    } else if (d.depth === 0) {
      // 目标（书名）
      el.append('circle')
        .attr('class', 'state-dot')
        .attr('cx', -w / 2 + 15)
        .attr('cy', -h / 2 + 13)
        .attr('r', 6)
        .attr('fill', STATE_COLOR[d.data.state])
      const lines = wrapName(d.data.name)
      const ys = lines.length === 1 ? [7] : [-7, 13]
      lines.forEach((ln, i) => {
        el.append('text')
          .attr('x', 0)
          .attr('y', ys[i])
          .attr('text-anchor', 'middle')
          .attr('font-size', lines.length === 1 ? 14 : 13)
          .attr('font-weight', 600)
          .attr('fill', '#243b33')
          .text(ln)
      })
    } else {
      // 章/节：顶部编号 + 单行名称
      el.append('text')
        .attr('x', 0)
        .attr('y', -h / 2 + 13)
        .attr('text-anchor', 'middle')
        .attr('font-size', 9.5)
        .attr('font-weight', 700)
        .attr('fill', '#8a9891')
        .text(d.num ?? '')
      el.append('circle')
        .attr('class', 'state-dot')
        .attr('cx', -w / 2 + 13)
        .attr('cy', -h / 2 + 13)
        .attr('r', 5)
        .attr('fill', STATE_COLOR[d.data.state])
      el.append('text')
        .attr('x', 0)
        .attr('y', 8)
        .attr('text-anchor', 'middle')
        .attr('font-size', 13)
        .attr('font-weight', 600)
        .attr('fill', '#243b33')
        .text(truncate(d.data.name, 10))
    }
  }
}
