import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import { computeWeekStats, weekLabel } from '../lib/review'
import { activeDaysOf, computeStreak, dayKey } from '../lib/achievements'
import { aiWeeklyReview } from '../lib/ai'
import { useAppStore } from '../store/appStore'

function fmtDay(t: number): string {
  const d = new Date(t)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

export default function Review() {
  const toast = useAppStore((s) => s.toast)
  const [reviewing, setReviewing] = useState(false)
  const [reviewText, setReviewText] = useState<string | null>(null)
  const activity = useLiveQuery(() => db.activity.toArray(), [])
  const sessions = useLiveQuery(() => db.feynman.toArray(), [])
  const nodes = useLiveQuery(() => db.nodes.toArray(), [])
  const lines = useLiveQuery(() => db.lines.toArray(), [])

  if (!activity || !sessions || !nodes || !lines) return <div className="muted">加载中…</div>

  const now = Date.now()
  const streak = computeStreak(activeDaysOf(activity), dayKey(now))
  const stats = computeWeekStats(activity, sessions, streak, now)

  const lineTitle = (id: string) => lines.find((l) => l.id === id)?.title ?? '未知学习线'
  const nodeName = (id: string) => nodes.find((n) => n.id === id)?.name ?? '未知节点'

  // 复述笔记本：所有写过复述的费曼会话，新的在前
  const notebook = sessions
    .filter((s) => s.retell.trim().length > 0)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 50)

  async function generateReview() {
    setReviewing(true)
    setReviewText(null)
    try {
      const text = await aiWeeklyReview(stats)
      setReviewText(text)
    } catch (e) {
      toast('周复盘生成失败：' + (e as Error).message, 'error')
    } finally {
      setReviewing(false)
    }
  }

  return (
    <div>
      <h1>📓 复盘</h1>
      <p className="muted" style={{ margin: '4px 0 18px' }}>
        复述笔记本收集你每一次费曼复述；每周复盘用数据帮你回顾这周学了什么、下周该把力气花在哪。
      </p>

      <div className="card review-week">
        <div className="review-week-head">
          <h3>📅 本周（{weekLabel(now)}）</h3>
          <button className="btn btn-primary btn-sm" onClick={generateReview} disabled={reviewing}>
            {reviewing ? '生成中…' : reviewText ? '🔄 重新生成 AI 周复盘' : '🤖 生成 AI 周复盘'}
          </button>
        </div>
        <div className="review-stats">
          <div className="stat-box"><span className="stat-num">{stats.nodeMastered}</span><span className="stat-label">掌握概念</span></div>
          <div className="stat-box"><span className="stat-num">{stats.edgeLit}</span><span className="stat-label">点亮关联</span></div>
          <div className="stat-box"><span className="stat-num">{stats.feynmanDone}</span><span className="stat-label">费曼学习</span></div>
          <div className="stat-box"><span className="stat-num">{stats.planGenerated}</span><span className="stat-label">学习计划</span></div>
          <div className="stat-box"><span className="stat-num">{stats.avgFeynmanScore || '—'}</span><span className="stat-label">复述均分</span></div>
          <div className="stat-box"><span className="stat-num">{streak}</span><span className="stat-label">连续天数</span></div>
        </div>
        {reviewText && (
          <div className="review-ai">
            <h4>🤖 AI 周复盘</h4>
            <p>{reviewText}</p>
          </div>
        )}
      </div>

      <div className="card">
        <h3>🗒️ 复述笔记本（{notebook.length} 条）</h3>
        {notebook.length === 0 ? (
          <p className="muted">
            还没有复述记录。到知识树里选一个节点，点「🎓 费曼 3×30 学习」，在「复述」阶段写下自己的话，就会出现在这里。
          </p>
        ) : (
          <div className="review-notebook">
            {notebook.map((s) => (
              <div key={s.id} className="review-note">
                <div className="review-note-head">
                  <span className="review-note-title">
                    {nodeName(s.nodeId)}
                    <span className="muted small"> · {lineTitle(s.lineId)} · {fmtDay(s.updatedAt)}</span>
                  </span>
                  {s.retellFeedback && (
                    <span
                      className={'review-note-score' + (s.retellFeedback.score >= 80 ? ' good' : s.retellFeedback.score >= 50 ? ' mid' : ' low')}
                    >
                      {s.retellFeedback.score} 分
                    </span>
                  )}
                </div>
                <p className="review-note-text">{s.retell}</p>
                {s.retellFeedback && s.retellFeedback.gaps.length > 0 && (
                  <ul className="review-note-gaps">
                    {s.retellFeedback.gaps.map((g, i) => (
                      <li key={i}>{g}</li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
