import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { TreeNode } from '../types'
import { STATE_LABEL, STATE_COLOR, STATE_MASTERY, stateFromMastery, FEYNMAN_STAGES } from '../types'
import { aiLightEdge, aiDecomposeNode } from '../lib/ai'
import { recordActivity, type BadgeDefinition } from '../lib/achievements'
import { useAppStore } from '../store/appStore'

const STATES: TreeNode['state'][] = ['unlearned', 'learning', 'mastered', 'fuzzy']

/** 成就解锁时逐条弹出庆祝提示 */
function toastUnlocks(toast: ReturnType<typeof useAppStore.getState>['toast'], unlocks: BadgeDefinition[]) {
  unlocks.forEach((b) => toast('✨ 成就解锁：' + b.emoji + ' ' + b.name + ' —— ' + b.desc, 'achievement'))
}

export default function NodePanel({
  node,
  parent,
  lineId,
  lineTitle,
  onFocus,
  onDeleteBranch
}: {
  node: TreeNode
  parent: TreeNode | null
  lineId: string
  lineTitle: string
  onFocus: () => void
  onDeleteBranch: () => void
}) {
  const toast = useAppStore((s) => s.toast)
  const openFeynman = useAppStore((s) => s.openFeynman)
  const [lighting, setLighting] = useState(false)
  const [decomposing, setDecomposing] = useState(false)
  const feynman = useLiveQuery(
    () => db.feynman.where('nodeId').equals(node.id).sortBy('updatedAt').then((rows) => rows[rows.length - 1] ?? null),
    [node.id]
  )
  const mastery = node.mastery ?? STATE_MASTERY[node.state]

  async function setState(state: TreeNode['state']) {
    if (state === node.state) return
    await db.nodes.update(node.id, { state, mastery: STATE_MASTERY[state], updatedAt: Date.now() })
    toast('状态已更新：' + STATE_LABEL[state], 'success')
    if (state === 'mastered') {
      const { unlocks } = await recordActivity('node-mastered', lineId)
      toastUnlocks(toast, unlocks)
    }
  }

  async function setMastery(value: number) {
    const state = stateFromMastery(value)
    await db.nodes.update(node.id, { mastery: value, state, updatedAt: Date.now() })
    if (state === 'mastered' && node.state !== 'mastered') {
      const { unlocks } = await recordActivity('node-mastered', lineId)
      toastUnlocks(toast, unlocks)
    }
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
      const { unlocks } = await recordActivity('edge-lit', lineId)
      toastUnlocks(toast, unlocks)
    } catch (e) {
      toast('生成失败：' + (e as Error).message, 'error')
    } finally {
      setLighting(false)
    }
  }

  async function decompose() {
    setDecomposing(true)
    try {
      const res = await aiDecomposeNode(node, lineTitle)
      if (res.done) {
        if (res.fill) {
          await db.nodes.update(node.id, { ...res.fill, updatedAt: Date.now() })
          toast('已补齐原子字段（掌握标准 + 实践任务），无需再拆', 'success')
        } else {
          toast('「' + node.name + '」已经是原子学习单元：' + (res.reason ?? '无需再分解'), 'info')
        }
      } else {
        await db.nodes.bulkAdd(res.children)
        toast('已分解出 ' + res.children.length + ' 个更细小的原子能力！', 'success')
      }
    } catch (e) {
      toast('分解失败：' + (e as Error).message, 'error')
    } finally {
      setDecomposing(false)
    }
  }

  return (
    <aside className="node-panel">
      <h2>{node.name}</h2>

      <div className="section">
        <h4>📊 掌握度 {mastery}%</h4>
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={mastery}
          onChange={(e) => setMastery(Number(e.target.value))}
          className="mastery-slider"
        />
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

      {node.minutes && (
        <div className="section">
          <h4>⏱️ 预计学习时长</h4>
          <p>{node.minutes} 分钟{node.minutes <= 90 ? '（原子单元）' : ''}</p>
        </div>
      )}

      {node.test && (
        <div className="section">
          <h4>✅ 掌握标准（独立测试）</h4>
          <p>{node.test}</p>
        </div>
      )}

      {node.practice && (
        <div className="section">
          <h4>🛠️ 最小实践任务</h4>
          <p>{node.practice}</p>
        </div>
      )}

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
        <button
          className="btn btn-primary"
          onClick={() => openFeynman(lineId, node.id)}
          title="费曼学习法：理解 30 分钟 → 复述 30 分钟 → 举例应用 30 分钟，AI 全程点评"
        >
          {feynman && feynman.status === 'active'
            ? '🎓 继续费曼 3×30（阶段 ' + (FEYNMAN_STAGES.indexOf(feynman.stage) + 1) + '/3）'
            : '🎓 费曼 3×30 学习（理解 → 复述 → 应用）'}
        </button>
        <button className="btn btn-primary" onClick={decompose} disabled={decomposing}>
          {decomposing ? 'AI 分解中…' : '🔬 继续分解此节点（不够原子就再拆）'}
        </button>
        <button className="btn" onClick={onFocus}>🔍 聚焦此节点（只看这棵子树）</button>
        <button className="btn btn-danger" onClick={onDeleteBranch}>🗑 删除此分支</button>
      </div>
    </aside>
  )
}
