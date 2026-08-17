import { useEffect, useMemo, useRef, useState } from 'react'
import * as d3 from 'd3'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db'
import { useAppStore } from '../store/appStore'
import { buildTree, computeStats } from '../lib/treeUtils'
import { STATE_COLOR, type TreeNode, type OnboardingSession } from '../types'
import { exportPng, exportSvg } from '../lib/exportImage'
import { renderTree } from '../lib/renderTree'
import { aiBuildDeepTree } from '../lib/ai'
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
  const [rebuilding, setRebuilding] = useState(false)
  const [rebuildPct, setRebuildPct] = useState(0)
  const [rebuildMsg, setRebuildMsg] = useState('')
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

  // 剪枝：已完全掌握的子分支自动折叠（每条学习线执行一次）
  const prunedLineRef = useRef<string | null>(null)
  useEffect(() => {
    if (!treeData || prunedLineRef.current === lineId) return
    prunedLineRef.current = lineId
    const fullyMastered = new Set<string>()
    const isFullyMastered = (id: string): boolean => {
      const node = treeData.byId.get(id)
      if (!node || node.state !== 'mastered') return false
      const kids = treeData.childrenMap.get(id) ?? []
      if (kids.length === 0) return true
      return kids.every((k) => isFullyMastered(k.id))
    }
    treeData.byId.forEach((n) => {
      if (isFullyMastered(n.id)) fullyMastered.add(n.id)
    })
    if (fullyMastered.size > 0) setCollapsed(fullyMastered)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [treeData, lineId])

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

  async function rebuildTree() {
    if (!line || !treeData || rebuilding) return
    const ok = window.confirm(
      '重新构建会用 AI 重新生成整棵知识树，并替换当前这棵树。\n' +
      '你已掌握（🟢）和模糊（🟡）的标记会按概念名称自动保留，其余节点状态重置。继续？'
    )
    if (!ok) return
    setRebuilding(true)
    setRebuildPct(0)
    try {
      // 沿用原有摸底会话（聊天记录 + 自评清单）；演示线没有会话则用空会话
      const existing = await db.onboarding.where('lineId').equals(lineId).first()
      const session: OnboardingSession = existing ?? {
        id: uid(),
        lineId,
        stage: 'done',
        messages: [],
        checklist: [],
        round: 3
      }
      // 记录旧树的掌握状态（按名称）
      const masteredNames = new Set<string>()
      const fuzzyNames = new Set<string>()
      treeData.byId.forEach((n) => {
        if (n.state === 'mastered') masteredNames.add(n.name)
        else if (n.state === 'fuzzy') fuzzyNames.add(n.name)
      })
      const result = await aiBuildDeepTree(line, session, {
        rebuildDemo: true,
        onProgress: (percent, msg) => {
          setRebuildPct(percent)
          setRebuildMsg(msg)
        }
      })
      const newNodes = result.nodes
      // 回填旧状态（按名称匹配）
      newNodes.forEach((n) => {
        if (masteredNames.has(n.name)) n.state = 'mastered'
        else if (fuzzyNames.has(n.name)) n.state = 'fuzzy'
      })
      await db.transaction('rw', db.nodes, db.lines, async () => {
        await db.nodes.where('lineId').equals(lineId).delete()
        await db.nodes.bulkAdd(newNodes)
        await db.lines.update(lineId, { generation: result.meta })
      })
      selectNode(null)
      setFocus(null)
      initializedRef.current = false
      setTick((x) => x + 1)
      if (result.note) {
        toast('知识树已重建：' + newNodes.length + ' 个节点｜' + result.note, 'info')
      } else {
        toast('知识树已重新构建：' + newNodes.length + ' 个节点（已掌握的标记已保留）', 'success')
      }
    } catch (e) {
      toast('重建失败：' + (e as Error).message, 'error')
    } finally {
      setRebuilding(false)
      setRebuildPct(0)
      setRebuildMsg('')
    }
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
        {line?.generation === undefined && stats && stats.total > 0 && (
          <span className="gen-badge gen-legacy" title="这条学习线是旧版本生成的，没有溯源信息。点「重新构建」即可获得溯源。">
            ⬜ 无溯源（旧版本生成）
          </span>
        )}
        {line?.generation && (
          <span
            className={'gen-badge ' + (line.generation.source === 'demo' ? 'gen-demo' : 'gen-ai')}
            title={
              '生成溯源：' +
              (line.generation.source === 'demo'
                ? '演示模式，未调用 AI'
                : [
                    'AI 生成',
                    '骨架模型：' + (line.generation.modelsUsed?.skeleton ?? line.generation.model),
                    '分解模型：' + (line.generation.modelsUsed?.decompose ?? line.generation.model),
                    '诊断清单模型：' + (line.generation.modelsUsed?.checklist ?? line.generation.model),
                    '摸底聊天模型：' + (line.generation.modelsUsed?.chat ?? line.generation.model),
                    '边点亮模型：' + (line.generation.modelsUsed?.lightEdge ?? line.generation.model),
                    '骨架尝试 ' + line.generation.skeletonAttempts + ' 次',
                    '分解调用 ' + line.generation.decompositionCalls + ' 次',
                    '停止原因 ' + line.generation.stopReason
                  ].join(' · '))
            }
          >
            {line.generation.source === 'demo'
              ? '🧪 DEMO · 未调用 AI'
              : '🤖 AI · 骨架 ' + (line.generation.modelsUsed?.skeleton ?? line.generation.model) + ' · 分解 ' + (line.generation.modelsUsed?.decompose ?? line.generation.model) + ' ×' + line.generation.decompositionCalls + ' · ' + (line.generation.complete ? '拆到底' : '未拆完')}
          </span>
        )}
        {stats && (
          <span className="stats">
            共 {stats.total} 个概念 · 已掌握 {stats.mastered} · 学习中 {stats.learning} · 模糊 {stats.fuzzy} · 未学 {stats.unlearned}
          </span>
        )}
        <span className="spacer" />
        <button className="btn btn-sm" onClick={expandAll}>全部展开</button>
        <button className="btn btn-sm" onClick={collapseAll}>全部折叠</button>
        <button className="btn btn-sm" onClick={resetView}>重置视图</button>
        <button className="btn btn-sm" onClick={rebuildTree} disabled={rebuilding} title="用 AI 重新生成整棵知识树并自动分解到底，保留已掌握标记">
          {rebuilding ? '重建中 ' + rebuildPct + '%' : '🔄 重新构建'}
        </button>
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

      {rebuilding && (
        <div className="rebuild-status">
          🔄 重新构建 {rebuildPct}% · {rebuildMsg || '进行中…'}
        </div>
      )}

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
            lineId={lineId}
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
