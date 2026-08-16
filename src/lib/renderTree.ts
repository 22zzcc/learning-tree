// ---------- 纯渲染函数：把 TreeNode 数据画成 D3 垂直树 SVG ----------
// 从 TreeView 组件中抽出，便于在 Node/jsdom 中直接测试生产渲染路径。

import * as d3 from 'd3'
import type { TreeNode } from '../types'
import { STATE_COLOR, STATE_BG, STATE_LABEL } from '../types'

export const NODE_W = 216
export const NODE_H = 64
export const DX = 260
export const DY = 140

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

  let minX = Infinity
  let maxX = -Infinity
  let maxY = 0
  rootD3.descendants().forEach((d) => {
    minX = Math.min(minX, d.x)
    maxX = Math.max(maxX, d.x)
    maxY = Math.max(maxY, d.y)
  })
  const width = Math.max(800, maxX - minX + DX)
  const height = Math.max(560, maxY + NODE_H + 120)

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

  const initialTransform = d3.zoomIdentity.translate(width / 2 - rootD3.x, 80)
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
        .attr('font-size', 11)
        .attr('fill', '#2e7d5b')
        .attr('paint-order', 'stroke')
        .attr('stroke', '#ffffff')
        .attr('stroke-width', 4)
        .attr('stroke-linejoin', 'round')
        .style('cursor', 'pointer')
        .text(truncate(l.target.data.edgeWhy, 20))
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

  g.append('rect')
    .attr('x', -NODE_W / 2)
    .attr('y', -NODE_H / 2)
    .attr('width', NODE_W)
    .attr('height', NODE_H)
    .attr('rx', 12)
    .attr('fill', (d) => STATE_BG[d.data.state])
    .attr('stroke', (d) => (d.data.id === selectedId ? '#2e7d5b' : STATE_COLOR[d.data.state]))
    .attr('stroke-width', (d) => (d.data.id === selectedId ? 3 : 1.5))
    .attr('filter', 'url(#card-shadow)')
    .style('cursor', 'pointer')

  g.append('circle')
    .attr('class', 'state-dot')
    .attr('cx', -NODE_W / 2 + 16)
    .attr('cy', -NODE_H / 2 + 15)
    .attr('r', 6)
    .attr('fill', (d) => STATE_COLOR[d.data.state])

  g.each(function (d) {
    const el = d3.select(this)
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
  })

  const withKids = g.filter((d) => (childrenMap.get(d.data.id)?.length ?? 0) > 0)
  withKids
    .append('circle')
    .attr('class', 'collapse-toggle')
    .attr('cx', 0)
    .attr('cy', NODE_H / 2)
    .attr('r', 10)
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
    .attr('y', NODE_H / 2 + 3.5)
    .attr('text-anchor', 'middle')
    .attr('font-size', 12)
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
}
