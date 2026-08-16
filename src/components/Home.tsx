import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useAppStore } from '../store/appStore'
import { computeStats } from '../lib/treeUtils'
import { STATE_COLOR, type LineCategory } from '../types'

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
