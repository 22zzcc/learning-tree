import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useAppStore } from '../store/appStore'
import { computeStats } from '../lib/treeUtils'
import { buildDailyPlan, type DailyPlan, type PlanMode } from '../lib/plan'
import { STATE_COLOR, type LineCategory, type LearningLine, type TreeNode } from '../types'

const LANES: { key: LineCategory; icon: string; title: string; desc: string }[] = [
  { key: 'expert', icon: '🎯', title: '六个月专家技术学习线', desc: '用六个月成为某个领域的专家：深度优先、系统推进' },
  { key: 'hobby', icon: '🎨', title: '兴趣爱好学习线', desc: '纯兴趣驱动，轻松学、随时学，享受过程' },
  { key: 'career', icon: '🛠️', title: '专业所需·技术栈学习线', desc: '鉴于你的专业，有必要将某某技能纳入你的技术栈' }
]

export default function Home({ onNewLine }: { onNewLine: (category: LineCategory) => void }) {
  const lines = useLiveQuery(() => db.lines.toArray(), [])
  const nodes = useLiveQuery(() => db.nodes.toArray(), [])
  const openLine = useAppStore((s) => s.openLine)
  const toast = useAppStore((s) => s.toast)

  if (!lines) return <div className="muted">加载中…</div>

  const statsByLine = new Map<string, ReturnType<typeof computeStats>>()
  if (nodes) {
    lines.forEach((l) => {
      statsByLine.set(l.id, computeStats(nodes.filter((n) => n.lineId === l.id)))
    })
  }

  const laneLines = (cat: LineCategory) => lines.filter((l) => (l.category ?? 'expert') === cat)

  async function removeLine(id: string, title: string) {
    if (!window.confirm('删除学习线「' + title + '」？该线的所有知识树节点都会删除，此操作不可恢复。')) return
    await db.transaction('rw', db.lines, db.nodes, db.onboarding, async () => {
      await db.nodes.where('lineId').equals(id).delete()
      await db.onboarding.where('lineId').equals(id).delete()
      await db.lines.delete(id)
    })
    toast('已删除学习线「' + title + '」', 'info')
  }

  return (
    <div>
      <div className="home-head">
        <div>
          <h1>我的学习线</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            每个目标一条学习线，分三个轨道并行推进。已掌握的知识随学习自动更新，形成你的动态知识档案。
          </p>
        </div>
      </div>

      {lines.length > 0 && <TodayPlan lines={lines} nodes={nodes ?? []} />}

      <div className="lane-grid">
        {LANES.map((lane) => {
          const items = laneLines(lane.key)
          return (
            <section key={lane.key} className="lane-box">
              <div className="lane-head">
                <h2>
                  {lane.icon} {lane.title}
                </h2>
                <span className="lane-count">{items.length}</span>
              </div>
              <p className="lane-desc">{lane.desc}</p>
              <div className="lane-items">
                {items.length === 0 && <div className="lane-empty">这个轨道还没有学习线</div>}
                {items.map((l) => {
                  const s = statsByLine.get(l.id)
                  return (
                    <div key={l.id} className="lane-item" onClick={() => openLine(l.id)}>
                      <div className="lane-item-top">
                        <span className="lane-item-title" title={l.reason || l.title}>{l.title}</span>
                        <button
                          className="btn btn-danger btn-sm"
                          onClick={(e) => {
                            e.stopPropagation()
                            removeLine(l.id, l.title)
                          }}
                          title="删除这条学习线"
                        >
                          ✕
                        </button>
                      </div>
                      {s && (
                        <>
                          <div className="line-stats">
                            <span>概念 {s.total}</span>
                            <span style={{ color: STATE_COLOR.mastered }}>🟢 {s.mastered}</span>
                            <span style={{ color: STATE_COLOR.learning }}>🟠 {s.learning}</span>
                            {s.fuzzy > 0 && <span style={{ color: STATE_COLOR.fuzzy }}>🟡 {s.fuzzy}</span>}
                          </div>
                          <div className="progress-track">
                            <div className="progress-fill" style={{ width: s.pct + '%' }} />
                          </div>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
              <button className="btn lane-add" onClick={() => onNewLine(lane.key)}>
                ＋ 新建
              </button>
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** 今日学习计划：最少学什么 / 极限挑战 */
function TodayPlan({ lines, nodes }: { lines: LearningLine[]; nodes: TreeNode[] }) {
  const [lineId, setLineId] = useState('')
  const [budget, setBudget] = useState(30)
  const [mode, setMode] = useState<PlanMode>('minimal')
  const [plan, setPlan] = useState<DailyPlan | null>(null)
  const openLine = useAppStore((s) => s.openLine)
  const selectNode = useAppStore((s) => s.selectNode)

  function generate() {
    if (!lineId) return
    const lineNodes = nodes.filter((n) => n.lineId === lineId)
    setPlan(buildDailyPlan(lineNodes, budget, mode))
  }

  function pickLine(id: string) {
    setLineId(id)
    setPlan(null)
  }

  return (
    <div className="card today-plan">
      <div className="today-plan-head">
        <h3>📅 今日学习计划</h3>
        <p className="muted small" style={{ margin: 0 }}>
          弹性时长：输入今天的可用分钟数，「最少」模式告诉你保底学什么；「极限」模式在同样时间内塞进最多的概念。
        </p>
      </div>
      <div className="plan-controls">
        <select value={lineId} onChange={(e) => pickLine(e.target.value)}>
          <option value="">选择学习线…</option>
          {lines.map((l) => (
            <option key={l.id} value={l.id}>{l.title}</option>
          ))}
        </select>
        <label className="plan-budget">
          可用
          <input
            type="number"
            min={1}
            max={600}
            value={budget}
            onChange={(e) => setBudget(Math.max(1, Number(e.target.value) || 1))}
          />
          分钟
        </label>
        <div className="seg">
          <button className={mode === 'minimal' ? 'active known' : ''} onClick={() => { setMode('minimal'); setPlan(null) }}>
            最少学什么
          </button>
          <button className={mode === 'extreme' ? 'active known' : ''} onClick={() => { setMode('extreme'); setPlan(null) }}>
            极限挑战
          </button>
        </div>
        <button className="btn btn-primary" onClick={generate} disabled={!lineId}>
          生成计划
        </button>
      </div>
      {plan && (
        <div className="plan-result">
          {plan.items.length === 0 ? (
            <p className="muted">{plan.note}</p>
          ) : (
            <>
              <p className="plan-summary">
                {mode === 'minimal' ? '今天至少学 ' : '极限挑战 '}
                <b>{plan.items.length}</b> 个概念 · 预计 <b>{plan.totalMinutes}</b> 分钟
                <span className="muted small">（{plan.note}）</span>
              </p>
              <ul className="plan-list">
                {plan.items.map((it) => (
                  <li key={it.node.id} className="plan-item">
                    <span className="legend-dot" style={{ background: STATE_COLOR[it.node.state] }} />
                    <span className="plan-name">{it.node.name}</span>
                    <span className="plan-meta muted small">
                      {it.minutes} 分钟 · {it.reason}
                    </span>
                    <button
                      className="btn btn-sm"
                      onClick={() => {
                        openLine(lineId)
                        selectNode(it.node.id)
                      }}
                    >
                      去学习 →
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
