// ---------- 纯渲染函数：把 TreeNode 数据画成「章节式」垂直知识树 ----------
// 布局像一本书的目录：目标(书名) → 大类(竖排) → 章(1.1) → 节(1.1.1)，整体窄而深。

import * as d3 from 'd3'
import type { TreeNode } from '../types'
import { STATE_COLOR, STATE_BG, STATE_LABEL, STATE_MASTERY } from '../types'

export const ROOT_W = 64           // 根（书名）：竖向卡片
export const ROOT_H = 84
export const V_W = 48            // 全部节点：竖向卡片宽度
export const DX = 120            // 同一大类内部：同级紧凑间距
export const DY = 170            // 层间垂直间距
export const GROUP_GAP = 180     // 不同大类之间：额外拉开距离

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
  const chars = [...d.data.name]
  const shown = Math.min(chars.length, 12)
  const w = d.depth === 0 ? ROOT_W : V_W
  return { w, h: Math.max(84, shown * 16 + 44) }
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

  // 分组布局：不同大类之间拉开距离，同一大类内部保持紧凑
  const topChildren = rootD3.children ?? []
  if (topChildren.length > 1) {
    let cursor = -Infinity
    topChildren.forEach((tc) => {
      let subMin = Infinity
      let subMax = -Infinity
      tc.each((d) => {
        subMin = Math.min(subMin, d.x)
        subMax = Math.max(subMax, d.x)
      })
      const shift = cursor === -Infinity ? 0 : cursor + GROUP_GAP - subMin
      if (shift !== 0) {
        tc.each((d) => {
          d.x += shift
        })
      }
      cursor = subMax + shift
    })
    const centers = topChildren.map((tc) => tc.x)
    const center = (Math.min(...centers) + Math.max(...centers)) / 2
    const delta = center - rootD3.x
    rootD3.each((d) => {
      if (d.depth > 0) d.x += delta
    })
    rootD3.x = center
  }

  let minX = Infinity
  let maxX = -Infinity
  let maxY = 0
  rootD3.descendants().forEach((d) => {
    minX = Math.min(minX, d.x)
    maxX = Math.max(maxX, d.x)
    maxY = Math.max(maxY, d.y)
  })
  const width = Math.max(700, maxX - minX + DX)
  const height = Math.max(560, maxY + 170)

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
    .attr('dy', 1)
    .attr('stdDeviation', 2.5)
    .attr('flood-color', '#1e3c2d')
    .attr('flood-opacity', 0.06)

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

  // ---- 边：弧线虚线，从大类（父）下端连到子类上端 ----
  const link = d3
    .linkVertical<
      { source: { x: number; y: number }; target: { x: number; y: number } },
      { x: number; y: number }
    >()
    .x((d) => d.x)
    .y((d) => d.y)

  const linkG = content.append('g').attr('class', 'links')
  rootD3.links().forEach((l) => {
    const srcH = cardSize(l.source).h
    const tgtH = cardSize(l.target).h
    const pts = {
      source: { x: l.source.x, y: l.source.y + srcH / 2 },
      target: { x: l.target.x, y: l.target.y - tgtH / 2 }
    }
    const lit = l.target.data.edgeLit
    linkG
      .append('path')
      .attr('class', 'link' + (lit ? ' lit' : ''))
      .attr('d', link(pts))
      .attr('fill', 'none')
      .attr('stroke', lit ? '#2e9e5b' : '#d1d1d6')
      .attr('stroke-width', lit ? 1.6 : 1.2)
      .attr('stroke-dasharray', lit ? '4 4' : '3 4')
    if (lit && l.target.data.edgeWhy) {
      const mx = (pts.source.x + pts.target.x) / 2
      const my = (pts.source.y + pts.target.y) / 2
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
        .text(truncate(l.target.data.edgeWhy, 12))
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
    .attr('data-depth', (d) => d.depth)
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
    .attr('stroke', '#d1d1d6')
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
    .attr('fill', '#8e8e93')
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
      .attr('rx', 14)
      .attr('fill', d.depth === 0 ? '#f5f5f7' : STATE_BG[d.data.state])
      .attr('stroke', selected ? '#2e9e5b' : 'none')
      .attr('stroke-width', selected ? 2.5 : 0)
      .attr('filter', 'url(#card-shadow)')
      .style('cursor', 'pointer')

    // 所有节点：章节编号（顶部横排）+ 名称竖排（一字一行）
    if (d.depth > 0) {
      el.append('text')
        .attr('x', 0)
        .attr('y', -h / 2 + 14)
        .attr('text-anchor', 'middle')
        .attr('font-size', 9.5)
        .attr('font-weight', 600)
        .attr('fill', '#8e8e93')
        .text(d.num ?? '')
    }
    const chars = [...d.data.name]
    const shown = chars.length > 12 ? [...chars.slice(0, 11), '…'] : chars
    shown.forEach((ch, i) => {
      el.append('text')
        .attr('x', 0)
        .attr('y', -h / 2 + (d.depth > 0 ? 32 : 26) + i * 16)
        .attr('text-anchor', 'middle')
        .attr('font-size', d.depth === 0 ? 15 : 13.5)
        .attr('font-weight', 500)
        .attr('fill', '#1d1d1f')
        .text(ch)
    })
    // 状态圆点（卡片底部）
    el.append('circle')
      .attr('class', 'state-dot')
      .attr('cx', 0)
      .attr('cy', h / 2 - 14)
      .attr('r', 5)
      .attr('fill', STATE_COLOR[d.data.state])
    // 掌握度进度条（卡片底部细条）
    const m = d.data.mastery ?? STATE_MASTERY[d.data.state]
    el.append('rect')
      .attr('class', 'mastery-bar')
      .attr('x', -w / 2 + 4)
      .attr('y', h / 2 - 2.5)
      .attr('width', Math.max(0, ((w - 8) * m) / 100))
      .attr('height', 2.5)
      .attr('rx', 1.25)
      .attr('fill', STATE_COLOR[d.data.state])
  }
}
