import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useAppStore } from '../store/appStore'
import { buildTree, computeStats } from '../lib/treeUtils'
import { STATE_COLOR, type TreeNode } from '../types'
import { exportPng, exportSvg } from '../lib/exportImage'
import { renderTree } from '../lib/renderTree'
import NodePanel from './NodePanel'

const LEGEND: { key: TreeNode['state']; label: string }[] = [
  { key: 'mastered', label: '已掌握' },
  { key: 'learning', label: '学习中' },
  { key: 'fuzzy', label: '模糊' },
  { key: 'unlearned', label: '未学' }
]

export default function TreeView({ lineId }: { lineId: string }) {
  const nodes = useLiveQuery(() => db.nodes.where('lineId').equals(lineId).toArray(), [lineId])
  const line = useLiveQuery(() => db.lines.get(lineId), [lineId])
  const svgRef = useRef<SVGSVGElement>(null)
  const transformRef = useRef<d3.ZoomTransform>(d3.zoomIdentity)
  const initializedRef = useRef(false)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [tick, setTick] = useState(0)
  const selectedId = useAppStore((s) => s.selectedNodeId)
  const focusId = useAppStore((s) => s.focusNodeId)
  const selectNode = useAppStore((s) => s.selectNode)
  const setFocus = useAppStore((s) => s.setFocus)
  const toast = useAppStore((s) => s.toast)

  const treeData = useMemo(() => (nodes ? buildTree(nodes) : null), [nodes])

  // 打开新学习线时自动选中根节点
  useEffect(() => {
    if (treeData?.root) selectNode(treeData.root.id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineId])

  useEffect(() => {
    const svgEl = svgRef.current
    if (!svgEl || !treeData || !treeData.root) return
    const root = (focusId && treeData.byId.get(focusId)) || treeData.root
    renderTree({
      svgEl,
      root,
      childrenMap: treeData.childrenMap,
      collapsed,
      selectedId,
      transform: transformRef.current,
      fitRoot: !initializedRef.current,
      onSelect: (id) => selectNode(id),
      onToggleCollapse: (id) => toggleCollapse(id),
      onFocus: (id) => {
        setFocus(id)
        initializedRef.current = false
        setTick((x) => x + 1)
        toast('已聚焦「' + treeData.byId.get(id)?.name + '」，双击其他节点继续聚焦，或点「返回整树」', 'info')
      },
      onBackgroundClick: () => selectNode(null),
      onTransformChange: (t) => {
        transformRef.current = t
      }
    })
    initializedRef.current = true
    return () => {
      d3.select(svgEl).selectAll('*').remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, collapsed, focusId, selectedId, tick, lineId])

  function toggleCollapse(id: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function resetView() {
    initializedRef.current = false
    setTick((x) => x + 1)
  }

  function expandAll() {
    setCollapsed(new Set())
  }

  function collapseAll() {
    if (!treeData) return
    const s = new Set<string>()
    treeData.byId.forEach((n) => {
      if ((treeData.childrenMap.get(n.id)?.length ?? 0) > 0) s.add(n.id)
    })
    setCollapsed(s)
  }

  async function deleteBranch(nodeId: string) {
    if (!treeData) return
    const toDelete = new Set<string>([nodeId])
    const stack = [nodeId]
    while (stack.length > 0) {
      const cur = stack.pop()!
      const kids = treeData.childrenMap.get(cur) ?? []
      kids.forEach((k) => {
        toDelete.add(k.id)
        stack.push(k.id)
      })
    }
    if (!window.confirm('删除该节点及其下 ' + (toDelete.size - 1) + ' 个子节点？此操作不可恢复。')) return
    await db.nodes.bulkDelete([...toDelete])
    selectNode(null)
    toast('已删除分支', 'info')
  }

  const stats = nodes ? computeStats(nodes) : null
  const selectedNode = selectedId ? treeData?.byId.get(selectedId) ?? null : null
  const selectedParent = selectedNode?.parentId ? treeData?.byId.get(selectedNode.parentId) ?? null : null
  const focusedNode = focusId ? treeData?.byId.get(focusId) : null

  return (
    <>
      <div className="tree-topbar">
        <button className="btn btn-sm" onClick={() => useAppStore.getState().go('home')}>← 学习线</button>
        <span className="title">{line?.title ?? '知识树'}</span>
        {stats && (
          <span className="stats">
            共 {stats.total} 个概念 · 已掌握 {stats.mastered} · 学习中 {stats.learning} · 模糊 {stats.fuzzy} · 未学 {stats.unlearned}
          </span>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={expandAll}>全部展开</button>
        <button className="btn btn-sm" onClick={collapseAll}>全部折叠</button>
        <button className="btn btn-sm" onClick={resetView}>重置视图</button>
        <button className="btn btn-sm" onClick={() => svgRef.current && exportSvg(svgRef.current, (line?.title ?? '知识树') + '.svg')}>
          导出 SVG
        </button>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => svgRef.current && exportPng(svgRef.current, (line?.title ?? '知识树') + '.png')}
        >
          导出 PNG 图片
        </button>
      </div>

      {focusedNode && (
        <div className="focus-bar">
          <span>🔍 聚焦模式：</span>
          <span className="name">{focusedNode.name}</span>
          <span className="muted small">（双击其他节点可继续聚焦）</span>
          <button
            className="btn btn-sm"
            onClick={() => {
              setFocus(null)
              initializedRef.current = false
              setTick((x) => x + 1)
            }}
          >
            返回整树
          </button>
        </div>
      )}

      <div className="tree-body">
        <div className="tree-canvas">
          <svg ref={svgRef} />
          <div className="tree-legend">
            {LEGEND.map((l) => (
              <span key={l.key} className="legend-item">
                <span className="legend-dot" style={{ background: STATE_COLOR[l.key] }} />
                {l.label}
              </span>
            ))}
            <span className="legend-item" style={{ marginLeft: 6 }}>双击节点 = 聚焦</span>
          </div>
        </div>
        {selectedNode ? (
          <NodePanel
            node={selectedNode}
            parent={selectedParent}
            lineTitle={line?.title ?? ''}
            onFocus={() => {
              setFocus(selectedNode.id)
              initializedRef.current = false
              setTick((x) => x + 1)
            }}
            onDeleteBranch={() => deleteBranch(selectedNode.id)}
          />
        ) : (
          <aside className="node-panel" style={{ alignItems: 'center', justifyContent: 'center', color: '#9aa5a1' }}>
            <div style={{ textAlign: 'center', lineHeight: 2 }}>
              <div style={{ fontSize: 40 }}>👆</div>
              点击树上的任意节点<br />查看定义、例子、关联<br />并标记掌握状态
            </div>
          </aside>
        )}
      </div>
    </>
  )
}
