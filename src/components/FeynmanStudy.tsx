import { useEffect, useMemo, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from '../db'
import type { FeynmanFeedback, FeynmanSession, FeynmanStage, TreeNode } from '../types'
import { FEYNMAN_STAGES, FEYNMAN_STAGE_LABEL, FEYNMAN_STAGE_MINUTES, STATE_MASTERY, stateFromMastery } from '../types'
import {
  feynmanRemainingSeconds,
  feynmanTimerRunning,
  feynmanNextStage,
  feynmanStageSeconds,
  feynmanSessionInit,
  feynmanAvgScore,
  feynmanCompletionBoost
} from '../lib/feynman'
import { aiFeynmanRetellFeedback, aiFeynmanTasks, aiFeynmanAnswerFeedback } from '../lib/ai'
import { useAppStore } from '../store/appStore'

const STAGE_ICON: Record<FeynmanStage, string> = {
  understand: '📖',
  retell: '🗣️',
  apply: '🧩'
}

const STAGE_HINT: Record<FeynmanStage, string> = {
  understand: '读懂材料：定义、原理、例子。目标是「懂」，不是「背」。',
  retell: '合上材料，用自己的话把这个概念讲清楚。讲不清的地方就是你的缺口。',
  apply: '把概念用起来：回答问题、完成实践。会用才算真的会。'
}

function formatClock(s: number): string {
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0')
}

/** 阶段计时器：显示剩余时间 + 开始/暂停/重置 + 每阶段时长（弹性时长） */
function StageTimer({
  remaining,
  running,
  minutes,
  onStart,
  onPause,
  onReset,
  onMinutesChange
}: {
  remaining: number
  running: boolean
  minutes: number
  onStart: () => void
  onPause: () => void
  onReset: () => void
  onMinutesChange: (m: number) => void
}) {
  return (
    <div className={'feynman-timer' + (remaining === 0 ? ' done' : '')}>
      <div className="feynman-timer-clock">{remaining === 0 ? '⏰ 时间到' : formatClock(remaining)}</div>
      <div className="feynman-timer-actions">
        {running ? (
          <button className="btn btn-sm" onClick={onPause}>⏸ 暂停</button>
        ) : (
          <button className="btn btn-sm" onClick={onStart} disabled={remaining === 0}>
            ▶ 开始计时
          </button>
        )}
        <button className="btn btn-sm" onClick={onReset}>↺ 重置 {minutes} 分钟</button>
        <label className="feynman-stage-minutes" title="弹性时长：改每阶段时长会重置当前阶段的计时">
          每阶段
          <select value={minutes} onChange={(e) => onMinutesChange(Number(e.target.value))}>
            <option value={5}>5 分钟</option>
            <option value={10}>10 分钟</option>
            <option value={15}>15 分钟</option>
            <option value={30}>30 分钟</option>
          </select>
        </label>
      </div>
    </div>
  )
}

/** 点评面板：分数 + 亮点 + 缺口 + 建议 */
function FeedbackPanel({ fb }: { fb: FeynmanFeedback }) {
  return (
    <div className="feynman-feedback">
      <div className="feynman-score">
        <span className="feynman-score-num">{fb.score}</span>
        <span className="feynman-score-total">/100</span>
      </div>
      {fb.strengths.length > 0 && (
        <div className="feynman-fb-block">
          <h5>✅ 讲得好的</h5>
          <ul>
            {fb.strengths.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
        </div>
      )}
      {fb.gaps.length > 0 && (
        <div className="feynman-fb-block">
          <h5>🕳️ 发现的缺口</h5>
          <ul>
            {fb.gaps.map((g, i) => (
              <li key={i}>{g}</li>
            ))}
          </ul>
        </div>
      )}
      {fb.suggestion && (
        <div className="feynman-fb-block">
          <h5>🧭 下一步</h5>
          <p>{fb.suggestion}</p>
        </div>
      )}
    </div>
  )
}

export default function FeynmanStudy({ lineId, nodeId, onClose }: { lineId: string; nodeId: string; onClose: () => void }) {
  const toast = useAppStore((s) => s.toast)
  const node = useLiveQuery(() => db.nodes.get(nodeId), [nodeId])
  const session = useLiveQuery(
    () => db.feynman.where('nodeId').equals(nodeId).sortBy('updatedAt').then((rows) => rows[rows.length - 1] ?? null),
    [nodeId]
  )
  // 每秒刷新一次，驱动倒计时
  const [now, setNow] = useState(() => Date.now())
  const [retellDraft, setRetellDraft] = useState('')
  const [answerDrafts, setAnswerDrafts] = useState<Record<string, string>>({})
  const [submittingRetell, setSubmittingRetell] = useState(false)
  const [generatingTasks, setGeneratingTasks] = useState(false)
  const [submittingAnswers, setSubmittingAnswers] = useState<Record<string, boolean>>({})
  const [finishing, setFinishing] = useState(false)

  // 节点存在且没有会话时，创建一条新会话
  useEffect(() => {
    if (!node || session !== null) return
    void db.feynman.put(feynmanSessionInit(lineId, nodeId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node, session])

  // 用会话里已有的内容初始化草稿（会话切换时）
  useEffect(() => {
    if (!session) return
    setRetellDraft(session.retell)
    setAnswerDrafts(session.answers)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.id])

  // 计时器运行中每秒 tick
  useEffect(() => {
    if (!session || !feynmanTimerRunning(session)) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [session?.stageEndsAt !== null, session?.id])

  const busy = submittingRetell || generatingTasks || finishing || Object.values(submittingAnswers).some(Boolean)

  const remaining = useMemo(
    () => (session ? feynmanRemainingSeconds(session, now) : FEYNMAN_STAGE_MINUTES * 60),
    [session, now]
  )
  const running = session ? feynmanTimerRunning(session) : false

  if (!node) {
    return (
      <div className="wizard-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="wizard feynman">
          <div className="wizard-head">
            <h2>🎓 费曼 3×30</h2>
            <button className="btn btn-sm" onClick={onClose}>✕</button>
          </div>
          <div className="wizard-body">
            <p className="muted">这个节点不存在（可能已被删除）。</p>
            <button className="btn" onClick={onClose}>关闭</button>
          </div>
        </div>
      </div>
    )
  }

  if (!session) return null // 正在创建会话

  async function patch(p: Partial<FeynmanSession>) {
    await db.feynman.update(session!.id, { ...p, updatedAt: Date.now() })
  }

  function startTimer() {
    void patch({ stageEndsAt: Date.now() + remaining * 1000 })
  }

  function pauseTimer() {
    void patch({ stageEndsAt: null, stageRemainingSeconds: remaining })
  }

  function resetTimer() {
    void patch({ stageEndsAt: null, stageRemainingSeconds: feynmanStageSeconds(session!.stageMinutes) })
    setNow(Date.now())
  }

  function changeStageMinutes(min: number) {
    void patch({ stageMinutes: min, stageEndsAt: null, stageRemainingSeconds: feynmanStageSeconds(min) })
    setNow(Date.now())
    toast('每阶段时长已改为 ' + min + ' 分钟', 'success')
  }

  async function advanceTo(next: FeynmanStage) {
    await patch({
      stage: next,
      stageEndsAt: null,
      stageRemainingSeconds: feynmanStageSeconds(session!.stageMinutes)
    })
    setNow(Date.now())
    if (next === 'apply' && session!.tasks.length === 0) {
      setGeneratingTasks(true)
      try {
        const tasks = await aiFeynmanTasks(node!)
        await db.feynman.update(session!.id, { tasks, updatedAt: Date.now() })
      } catch (e) {
        toast('出题失败：' + (e as Error).message, 'error')
      } finally {
        setGeneratingTasks(false)
      }
    }
  }

  async function submitRetell() {
    const text = retellDraft.trim()
    if (text.length < 10) {
      toast('复述至少写 10 个字，试着讲出「是什么、为什么、怎么用」', 'error')
      return
    }
    setSubmittingRetell(true)
    try {
      const fb = await aiFeynmanRetellFeedback(node!, text)
      await patch({ retell: text, retellFeedback: fb })
      toast('AI 点评完成：' + fb.score + ' 分', 'success')
    } catch (e) {
      toast('点评失败：' + (e as Error).message, 'error')
    } finally {
      setSubmittingRetell(false)
    }
  }

  async function submitAnswer(taskId: string, answer: string) {
    const text = answer.trim()
    if (text.length < 10) {
      toast('回答至少写 10 个字，把思路展开', 'error')
      return
    }
    const task = session!.tasks.find((t) => t.id === taskId)
    if (!task) return
    setSubmittingAnswers((m) => ({ ...m, [taskId]: true }))
    try {
      const fb = await aiFeynmanAnswerFeedback(node!, task, text)
      await patch({
        answers: { ...session!.answers, [taskId]: text },
        answerFeedbacks: { ...session!.answerFeedbacks, [taskId]: fb }
      })
      toast('第 ' + (session!.tasks.indexOf(task) + 1) + ' 题评分：' + fb.score + ' 分', 'success')
    } catch (e) {
      toast('评分失败：' + (e as Error).message, 'error')
    } finally {
      setSubmittingAnswers((m) => ({ ...m, [taskId]: false }))
    }
  }

  async function finish() {
    if (!session!.retellFeedback || session!.tasks.length === 0) return
    setFinishing(true)
    try {
      const avg = feynmanAvgScore(session!)
      const boost = feynmanCompletionBoost(avg)
      const cur = node!.mastery ?? STATE_MASTERY[node!.state]
      const mastery = Math.min(100, cur + boost)
      await db.transaction('rw', db.nodes, db.feynman, async () => {
        await db.nodes.update(nodeId, { mastery, state: stateFromMastery(mastery), updatedAt: Date.now() })
        await db.feynman.update(session!.id, { status: 'done', avgScore: avg, updatedAt: Date.now() })
      })
      toast('🎉 费曼学习完成！平均分 ' + avg + '，掌握度 +' + boost + ' → ' + mastery + '%', 'success')
    } catch (e) {
      toast('完成失败：' + (e as Error).message, 'error')
    } finally {
      setFinishing(false)
    }
  }

  async function restart() {
    await db.feynman.put(feynmanSessionInit(lineId, nodeId))
    setRetellDraft('')
    setAnswerDrafts({})
  }

  // 完成态：总结页
  if (session.status === 'done') {
    return (
      <div className="wizard-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
        <div className="wizard feynman">
          <div className="wizard-head">
            <h2>🎓 费曼 3×30 · {node.name}</h2>
            <button className="btn btn-sm" onClick={onClose}>✕</button>
          </div>
          <div className="wizard-body">
            <div className="feynman-done">
              <div className="feynman-done-emoji">🎉</div>
              <h3>本轮学习完成</h3>
              <p>平均分 <b>{session.avgScore}</b>，掌握度已提升（+{feynmanCompletionBoost(session.avgScore)}）。</p>
              <p className="muted small">
                费曼说：讲不清就说明没懂。过几天再回来「复述」一遍，能讲得比今天更短、更清楚，就是真的掌握了。
              </p>
              <div style={{ display: 'flex', gap: 10, justifyContent: 'center' }}>
                <button className="btn btn-primary" onClick={restart}>再来一轮</button>
                <button className="btn" onClick={onClose}>关闭</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const stage = session.stage
  const stageIdx = FEYNMAN_STAGES.indexOf(stage)
  const allTasksScored = session.tasks.length > 0 && session.tasks.every((t) => !!session.answerFeedbacks[t.id])
  const canFinish = !!session.retellFeedback && allTasksScored

  return (
    <div className="wizard-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wizard feynman">
        <div className="wizard-head">
          <h2>🎓 费曼 3×30 · {node.name}</h2>
          <button className="btn btn-sm" onClick={onClose} disabled={busy} title="关闭后进度自动保存，可随时回来继续">
            ✕
          </button>
        </div>

        <div className="wizard-body">
          <div className="feynman-steps">
            {FEYNMAN_STAGES.map((s, i) => (
              <div
                key={s}
                className={
                  'feynman-step' +
                  (i < stageIdx ? ' done' : i === stageIdx ? ' current' : '')
                }
              >
                <span className="feynman-step-icon">{i < stageIdx ? '✅' : STAGE_ICON[s]}</span>
                <span className="feynman-step-label">
                  {FEYNMAN_STAGE_LABEL[s]}
                  <span className="feynman-step-min">{FEYNMAN_STAGE_MINUTES} 分钟</span>
                </span>
              </div>
            ))}
          </div>

          <p className="feynman-hint">{STAGE_HINT[stage]}</p>

          <StageTimer
            remaining={remaining}
            running={running}
            minutes={session.stageMinutes}
            onStart={startTimer}
            onPause={pauseTimer}
            onReset={resetTimer}
            onMinutesChange={changeStageMinutes}
          />

          {stage === 'understand' && (
            <div className="feynman-material">
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
              {node.practice && (
                <div className="section">
                  <h4>🛠️ 最小实践任务</h4>
                  <p>{node.practice}</p>
                </div>
              )}
              {node.test && (
                <div className="section">
                  <h4>✅ 掌握标准</h4>
                  <p>{node.test}</p>
                </div>
              )}
              <button
                className="btn btn-primary"
                onClick={() => advanceTo(feynmanNextStage(stage)!)}
                disabled={busy}
              >
                {remaining > 0 ? '⏭ 我理解了，提前进入复述' : '✅ 时间到，进入复述'}
              </button>
            </div>
          )}

          {stage === 'retell' && (
            <div className="feynman-retell">
              <textarea
                className="feynman-textarea"
                placeholder={'合上材料，用自己的话讲清楚「' + node.name + '」：它是什么？为什么成立？能用来干什么？\n\n（写完点「提交点评」，AI 会帮你找缺口）'}
                value={retellDraft}
                onChange={(e) => setRetellDraft(e.target.value)}
                rows={8}
              />
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={submitRetell} disabled={submittingRetell || busy}>
                  {submittingRetell ? 'AI 点评中…' : session.retellFeedback ? '🔄 修改后重新提交点评' : '🗣️ 提交复述，让 AI 点评'}
                </button>
                <button
                  className="btn"
                  onClick={() => advanceTo(feynmanNextStage(stage)!)}
                  disabled={!session.retellFeedback || busy}
                  title={session.retellFeedback ? '' : '先提交一次复述并获得点评'}
                >
                  {remaining > 0 ? '⏭ 进入举例应用' : '✅ 进入举例应用'}
                </button>
              </div>
              {session.retellFeedback && <FeedbackPanel fb={session.retellFeedback} />}
            </div>
          )}

          {stage === 'apply' && (
            <div className="feynman-apply">
              {generatingTasks && <p className="muted">🧩 AI 正在出应用场景题…</p>}
              {!generatingTasks && session.tasks.length === 0 && (
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-primary" onClick={() => advanceTo('apply')} disabled={busy}>
                    🧩 生成应用场景题
                  </button>
                </div>
              )}
              {session.tasks.map((task, i) => {
                const fb = session.answerFeedbacks[task.id]
                const submitting = submittingAnswers[task.id]
                return (
                  <div key={task.id} className="feynman-task">
                    <h4>
                      {i + 1}. {task.question}
                    </h4>
                    {task.hint && <p className="muted small">💡 提示：{task.hint}</p>}
                    {fb ? (
                      <FeedbackPanel fb={fb} />
                    ) : (
                      <>
                        <textarea
                          className="feynman-textarea"
                          placeholder="写下你的作答（至少 10 字）…"
                          value={answerDrafts[task.id] ?? ''}
                          onChange={(e) => setAnswerDrafts((m) => ({ ...m, [task.id]: e.target.value }))}
                          rows={4}
                        />
                        <button
                          className="btn btn-sm btn-primary"
                          onClick={() => submitAnswer(task.id, answerDrafts[task.id] ?? '')}
                          disabled={submitting || busy}
                        >
                          {submitting ? '评分中…' : '提交作答，让 AI 评分'}
                        </button>
                      </>
                    )}
                  </div>
                )
              })}
              {session.tasks.length > 0 && (
                <button className="btn btn-primary btn-lg" onClick={finish} disabled={!canFinish || busy}>
                  {finishing ? '结算中…' : canFinish ? '🎉 完成费曼 3×30（结算掌握度加成）' : '先完成每道题的作答'}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
