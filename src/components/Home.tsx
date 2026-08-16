import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { useAppStore } from '../store/appStore'
import { computeStats } from '../lib/treeUtils'
import { STATE_COLOR } from '../types'

export default function Home({ onNewLine }: { onNewLine: () => void }) {
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
            每条学习线 = 一个独立目标，可以并行推进、互不干扰。已掌握的知识随学习自动更新，形成你的动态知识档案。
          </p>
        </div>
        <button className="btn btn-primary" onClick={onNewLine}>＋ 新建学习线</button>
      </div>

      {lines.length === 0 ? (
        <div className="empty-state" style={{ padding: '60px 20px' }}>
          <div className="empty-emoji">🌱</div>
          <h2>还没有学习线</h2>
          <p>新建一条学习线，AI 会先摸底你已掌握的知识，再生成属于你的知识树。</p>
        </div>
      ) : (
        <div className="line-grid">
          {lines.map((l) => {
            const s = statsByLine.get(l.id)
            return (
              <div key={l.id} className="card line-card" onClick={() => openLine(l.id)}>
                <h3>{l.title}</h3>
                <div className="line-reason">{l.reason || '（未填写学习动机）'}</div>
                {s && (
                  <>
                    <div>
                      <div className="line-stats" style={{ marginBottom: 6 }}>
                        <span>概念 {s.total} 个</span>
                        <span style={{ color: STATE_COLOR.mastered }}>● 已掌握 {s.mastered}</span>
                        <span style={{ color: STATE_COLOR.learning }}>● 学习中 {s.learning}</span>
                        {s.fuzzy > 0 && <span style={{ color: STATE_COLOR.fuzzy }}>● 模糊 {s.fuzzy}</span>}
                      </div>
                      <div className="progress-track">
                        <div className="progress-fill" style={{ width: s.pct + '%' }} />
                      </div>
                    </div>
                    <div className="line-actions">
                      <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); openLine(l.id) }}>
                        进入知识树 →
                      </button>
                      <button className="btn btn-danger btn-sm" onClick={(e) => { e.stopPropagation(); removeLine(l.id, l.title) }}>
                        删除
                      </button>
                    </div>
                  </>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
