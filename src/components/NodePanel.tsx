import { useState } from 'react'
import { db } from '../db'
import type { TreeNode } from '../types'
import { STATE_LABEL, STATE_COLOR } from '../types'
import { aiLightEdge, aiDecomposeNode } from '../lib/ai'
import { useAppStore } from '../store/appStore'

const STATES: TreeNode['state'][] = ['unlearned', 'learning', 'mastered', 'fuzzy']

export default function NodePanel({
  node,
  parent,
  lineTitle,
  onFocus,
  onDeleteBranch
}: {
  node: TreeNode
  parent: TreeNode | null
  lineTitle: string
  onFocus: () => void
  onDeleteBranch: () => void
}) {
  const toast = useAppStore((s) => s.toast)
  const [lighting, setLighting] = useState(false)
  const [decomposing, setDecomposing] = useState(false)

  async function setState(state: TreeNode['state']) {
    if (state === node.state) return
    await db.nodes.update(node.id, { state, updatedAt: Date.now() })
    toast('状态已更新：' + STATE_LABEL[state], 'success')
  }

  async function lightEdge() {
    if (!parent) return
    setLighting(true)
    try {
      const res = await aiLightEdge(parent, node)
      await db.nodes.update(node.id, {
        edgeWhy: res.edgeWhy,
        edgeExamples: res.edgeExamples,
        edgeLit: true,
        updatedAt: Date.now()
      })
      toast('关联已点亮！边上的文字就是「为什么」', 'success')
    } catch (e) {
      toast('生成失败：' + (e as Error).message, 'error')
    } finally {
      setLighting(false)
    }
  }

  async function decompose() {
    setDecomposing(true)
    try {
      const children = await aiDecomposeNode(node, lineTitle)
      await db.nodes.bulkAdd(children)
      toast('已分解出 ' + children.length + ' 个更细小的知识领域！觉得还不够细可以继续点', 'success')
    } catch (e) {
      toast('分解失败：' + (e as Error).message, 'error')
    } finally {
      setDecomposing(false)
    }
  }

  return (
    <aside className="node-panel">
      <h2>{node.name}</h2>
      <div className="state-pills">
        {STATES.map((s) => (
          <button
            key={s}
            className={'state-pill' + (node.state === s ? ' active' : '')}
            style={node.state === s ? { background: STATE_COLOR[s], borderColor: STATE_COLOR[s] } : {}}
            onClick={() => setState(s)}
            title={'标记为' + STATE_LABEL[s]}
          >
            {STATE_LABEL[s]}
          </button>
        ))}
      </div>

      <div className="section">
        <h4>📖 定义</h4>
        <p>{node.definition}</p>
      </div>

      {node.principle && (
        <div className="section">
          <h4>⚙️ 原理</h4>
          <p>{node.principle}</p>
        </div>
      )}

      <div className="section">
        <h4>🔍 例子</h4>
        <p>{node.example}</p>
      </div>

      <div className="section">
        <h4>💡 为什么重要</h4>
        <p>{node.whyImportant}</p>
      </div>

      {parent && (
        <div className="section">
          <h4>🔗 与「{parent.name}」的关联</h4>
          {node.edgeLit ? (
            <>
              <p style={{ color: '#2e7d5b' }}>
                <b>为什么：</b>
                {node.edgeWhy}
              </p>
              <ul className="example-list">
                {node.edgeExamples.map((ex, i) => (
                  <li key={i}>{ex}</li>
                ))}
              </ul>
              <button className="btn btn-sm" onClick={lightEdge} disabled={lighting}>
                {lighting ? '生成中…' : '🔄 重新生成'}
              </button>
            </>
          ) : (
            <>
              <p className="muted">
                这条边还没有点亮。AI 会枚举「{parent.name}」的相似例子，说明它们如何自然引出「{node.name}」。
              </p>
              <button className="btn btn-primary btn-sm" onClick={lightEdge} disabled={lighting}>
                {lighting ? 'AI 生成中…' : '⚡ 点亮这条边（例子 + 为什么）'}
              </button>
            </>
          )}
        </div>
      )}

      <div className="section" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <button className="btn btn-primary" onClick={decompose} disabled={decomposing}>
          {decomposing ? 'AI 分解中…' : '🔬 继续分解此节点（不够细就再拆）'}
        </button>
        <button className="btn" onClick={onFocus}>🔍 聚焦此节点（只看这棵子树）</button>
        <button className="btn btn-danger" onClick={onDeleteBranch}>🗑 删除此分支</button>
      </div>
    </aside>
  )
}
