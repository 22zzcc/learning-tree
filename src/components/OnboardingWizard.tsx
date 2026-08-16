import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, getSettings } from '../db'
import type { LearningLine, OnboardingSession, TreeNode, LineCategory, GoalSpec, GenerationMeta } from '../types'
import { stateFromMastery } from '../types'
import { aiChatQuestion, aiBuildDeepTree, aiBuildChecklistFromTree, aiGoalSpec, aiBuildDiagnosticQuiz, aiEvaluateAnswer, isDemoMode, type QuizItem, type QuizResult } from '../lib/ai'
import { useAppStore } from '../store/appStore'

const CATEGORY_OPTIONS: { key: LineCategory; icon: string; label: string; hint: string }[] = [
  { key: 'expert', icon: '🎯', label: '六个月专家技术学习线', hint: '用六个月成为某领域专家，深度优先、系统推进' },
  { key: 'hobby', icon: '🎨', label: '兴趣爱好学习线', hint: '纯兴趣驱动，轻松学、随时学' },
  { key: 'career', icon: '🛠️', label: '专业所需·技术栈学习线', hint: '鉴于你的专业，把必要技能纳入技术栈' }
]

export default function OnboardingWizard({ initialCategory, onClose }: { initialCategory: LineCategory; onClose: () => void }) {
  const [line, setLine] = useState<LearningLine | null>(null)
  const [session, setSession] = useState<OnboardingSession | null>(null)
  const [pendingNodes, setPendingNodes] = useState<TreeNode[] | null>(null)
  const [category, setCategory] = useState<LineCategory>(initialCategory)
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const [genMsg, setGenMsg] = useState('')
  const [specEdit, setSpecEdit] = useState<{ goal: string; deliverable: string; criteriaText: string; options: string[] | null } | null>(null)
  const [quiz, setQuiz] = useState<QuizItem[] | null>(null)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [quizScores, setQuizScores] = useState<QuizResult[] | null>(null)
  const [genMeta, setGenMeta] = useState<GenerationMeta | null>(null)
  const settings = useLiveQuery(() => getSettings(), [])
  const demo = settings ? isDemoMode(settings) : true
  const openLine = useAppStore((s) => s.openLine)
  const toast = useAppStore((s) => s.toast)
  const logRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [session?.messages])

  async function createLine() {
    const t = title.trim()
    if (!t) {
      toast('请先填写学习目标', 'error')
      return
    }
    setBusy(true)
    try {
      const newLine: LearningLine = { id: uid(), title: t, reason: reason.trim(), category, createdAt: Date.now(), status: 'active' }
      const sess: OnboardingSession = { id: uid(), lineId: newLine.id, stage: 'chat', messages: [], checklist: [], round: 0 }
      await db.transaction('rw', db.lines, db.onboarding, async () => {
        await db.lines.add(newLine)
        await db.onboarding.add(sess)
      })
      setLine(newLine)
      // Goal Specification：先把模糊目标澄清为可检验的终局能力定义
      let spec: GoalSpec
      try {
        spec = await aiGoalSpec(newLine)
      } catch (e) {
        spec = {
          goal: newLine.title,
          deliverable: '一件用「' + newLine.title + '」完成的真实成果',
          criteria: ['能独立完成一次最小实践', '能向别人讲清楚它是什么']
        }
        toast('目标规格书生成失败，已用原始目标代替（可在下一步点「换一版」重试）：' + (e as Error).message.slice(0, 100), 'error')
      }
      const withSpec: OnboardingSession = { ...sess, goalSpec: spec, stage: 'goal' }
      await db.onboarding.put(withSpec)
      setSession(withSpec)
      setSpecEdit({
        goal: spec.goal,
        deliverable: spec.deliverable,
        criteriaText: spec.criteria.join('\n'),
        options: null
      })
    } catch (e) {
      toast('创建失败：' + (e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function sendAnswer() {
    if (!line || !session || busy) return
    const text = input.trim()
    if (!text) return
    setInput('')
    setBusy(true)
    const round = session.round + 1
    const withUser: OnboardingSession = {
      ...session,
      round,
      messages: [...session.messages, { id: uid(), role: 'user', text, at: Date.now() }]
    }
    await db.onboarding.put(withUser)
    setSession(withUser)
    if (round >= 3) {
      setBusy(false)
      return
    }
    const q = await aiChatQuestion(line, withUser)
    const withAi: OnboardingSession = {
      ...withUser,
      messages: [...withUser.messages, { id: uid(), role: 'ai', text: q, at: Date.now() }]
    }
    await db.onboarding.put(withAi)
    setSession(withAi)
    setBusy(false)
  }

  async function regenerateSpec(chosenScope?: string) {
    if (!line || busy) return
    setBusy(true)
    try {
      const spec = await aiGoalSpec(line, chosenScope)
      setSpecEdit({
        goal: spec.goal,
        deliverable: spec.deliverable,
        criteriaText: spec.criteria.join('\n'),
        options: spec.options ?? null
      })
    } catch (e) {
      toast('生成失败：' + (e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function confirmGoalSpec() {
    if (!line || !session || !specEdit || busy) return
    setBusy(true)
    try {
      const criteria = specEdit.criteriaText.split('\n').map((s) => s.trim()).filter(Boolean)
      if (!specEdit.deliverable.trim() || criteria.length === 0) {
        toast('交付物和成功标准不能为空', 'error')
        return
      }
      const spec: GoalSpec = { goal: specEdit.goal.trim(), deliverable: specEdit.deliverable.trim(), criteria }
      const withSpec: OnboardingSession = { ...session, goalSpec: spec, stage: 'chat' }
      await db.onboarding.put(withSpec)
      const q = await aiChatQuestion(line, withSpec)
      const withAi: OnboardingSession = {
        ...withSpec,
        messages: [...withSpec.messages, { id: uid(), role: 'ai', text: q, at: Date.now() }]
      }
      await db.onboarding.put(withAi)
      setSession(withAi)
    } catch (e) {
      toast('失败：' + (e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 生成能力图谱（先建规范图谱，再诊断，最后裁剪出个性化树） */
  async function generateGraph(skipDiagnostic = false) {
    if (!line || !session || busy) return
    setBusy(true)
    setGenMsg('AI 正在生成能力图谱（骨架 + 自动深度分解）…')
    try {
      const finalSession: OnboardingSession = { ...session, stage: 'generating' }
      const result = await aiBuildDeepTree(line, finalSession, {
        onProgress: (percent, msg) => setGenMsg(msg + '（' + percent + '%）')
      })
      if (result.note) toast(result.note, 'info')
      setGenMeta(result.meta)
      if (skipDiagnostic) {
        await db.nodes.bulkAdd(result.nodes)
        await db.lines.update(line.id, { generation: result.meta })
        await db.onboarding.put({ ...finalSession, stage: 'done' })
        toast('能力图谱已生成：' + result.nodes.length + ' 个能力节点', 'success')
        onClose()
        openLine(line.id)
        return
      }
      setPendingNodes(result.nodes)
      const items = await aiBuildChecklistFromTree(line, finalSession, result.nodes)
      const updated: OnboardingSession = { ...finalSession, checklist: items, stage: 'checklist' }
      await db.onboarding.put(updated)
      setSession(updated)
      setGenMsg('')
    } catch (e) {
      toast('生成失败：' + (e as Error).message, 'error')
      setGenMsg('')
    } finally {
      setBusy(false)
    }
  }

  function setItemState(itemId: string, state: 'known' | 'fuzzy' | 'unknown') {
    if (!session) return
    const updated: OnboardingSession = {
      ...session,
      checklist: session.checklist.map((c) => (c.id === itemId ? { ...c, state } : c))
    }
    db.onboarding.put(updated)
    setSession(updated)
  }

  /** 从图谱里挑出诊断测试目标：优先「模糊」的，其次是「不会」的关键能力（最多 4 个） */
  function pickQuizTargets(): TreeNode[] {
    if (!pendingNodes || !session) return []
    const fuzzy = session.checklist.filter((c) => c.state === 'fuzzy')
    const unknown = session.checklist.filter((c) => c.state === 'unknown')
    const targets: TreeNode[] = []
    for (const c of [...fuzzy, ...unknown]) {
      const node = pendingNodes.find(
        (n) => n.name.includes(c.name.replace(/[「」]/g, '')) || c.name.includes(n.name)
      )
      if (node && !targets.some((t) => t.id === node.id)) targets.push(node)
      if (targets.length >= 4) break
    }
    return targets
  }

  /** 进入证据式诊断：对关键能力出题，用户作答后 AI 评分 */
  async function startQuiz() {
    if (!line || !session || !pendingNodes || busy) return
    const targets = pickQuizTargets()
    if (targets.length === 0) {
      finishDiagnostic()
      return
    }
    setBusy(true)
    setGenMsg('AI 正在根据你的能力图谱出诊断题…')
    try {
      const items = await aiBuildDiagnosticQuiz(line, targets)
      setQuiz(items)
      setAnswers({})
      setQuizScores(null)
      const updated: OnboardingSession = { ...session, stage: 'quiz' }
      await db.onboarding.put(updated)
      setSession(updated)
      setGenMsg('')
    } catch (e) {
      toast('出题失败：' + (e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  async function submitQuiz() {
    if (!line || !quiz || busy) return
    setBusy(true)
    setGenMsg('AI 正在评分（逐题核对评分要点）…')
    try {
      const results = await Promise.all(
        quiz.map((q) => aiEvaluateAnswer(line, q, answers[q.nodeId] ?? ''))
      )
      setQuizScores(results)
      setGenMsg('')
    } catch (e) {
      toast('评分失败：' + (e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  /** 应用诊断结果：自评（90/25）+ 诊断测试分数（覆盖自评），生成个性化树 */
  async function finishDiagnostic() {
    if (!line || !session || !pendingNodes || busy) return
    setBusy(true)
    setGenMsg('正在应用诊断结果，裁剪出你的个性化能力图谱…')
    try {
      const known = session.checklist.filter((c) => c.state === 'known').map((c) => c.name)
      const fuzzy = session.checklist.filter((c) => c.state === 'fuzzy').map((c) => c.name)
      pendingNodes.forEach((n) => {
        const match = (k: string) => n.name.includes(k.replace(/[「」]/g, '')) || k.includes(n.name)
        if (known.some(match)) {
          n.state = 'mastered'
          n.mastery = 90
        } else if (fuzzy.some(match)) {
          n.state = 'fuzzy'
          n.mastery = 25
        }
      })
      // 证据式诊断分数覆盖自评
      const scoreMap = new Map((quizScores ?? []).map((r) => [r.nodeId, r.score]))
      pendingNodes.forEach((n) => {
        const s = scoreMap.get(n.id)
        if (s !== undefined) {
          n.mastery = s
          n.state = stateFromMastery(s)
        }
      })
      await db.nodes.bulkAdd(pendingNodes)
      if (genMeta) await db.lines.update(line.id, { generation: genMeta })
      await db.onboarding.put({ ...session, stage: 'done' })
      toast('你的个性化能力图谱已生成！掌握度来自自评 + 诊断测试评分', 'success')
      onClose()
      openLine(line.id)
    } catch (e) {
      toast('保存失败：' + (e as Error).message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const stage = session?.stage ?? 'intro'
  const knownCount = session?.checklist.filter((c) => c.state === 'known').length ?? 0

  return (
    <div className="wizard-overlay" onClick={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="wizard">
        <div className="wizard-head">
          <h2>🌱 新建学习线</h2>
          <button className="btn btn-sm" onClick={onClose} disabled={busy}>✕ 关闭</button>
        </div>

        <div className="wizard-body">
          {demo && (
            <div className="demo-banner">
              <b>演示模式：</b>未配置 API Key，能力图谱使用内置模板。在「设置」页填入 Key 后即可获得真实的 AI 能力建模。
            </div>
          )}

          {stage === 'intro' && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                先选择这条学习线属于哪个轨道，再告诉 AI 你想获得什么能力。流程：<b>摸底对话 → 生成规范能力图谱 → 基于图谱诊断 → 裁剪出你的个性化树</b>。
              </p>
              <div className="cat-picker">
                {CATEGORY_OPTIONS.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    className={'cat-option' + (category === c.key ? ' active' : '')}
                    onClick={() => setCategory(c.key)}
                  >
                    <span className="cat-icon">{c.icon}</span>
                    <span className="cat-label">{c.label}</span>
                    <span className="cat-hint">{c.hint}</span>
                  </button>
                ))}
              </div>
              <div className="form-row">
                <label>🎯 学习目标</label>
                <input
                  type="text"
                  placeholder="例如：掌握短除法 / 看懂基础经济新闻 / 学会自由泳"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && createLine()}
                  autoFocus
                />
              </div>
              <div className="form-row">
                <label>💭 为什么想学（可选，帮助 AI 定制路线）</label>
                <textarea
                  rows={2}
                  placeholder="例如：孩子正在学分数约分，我想自己先弄明白再教他"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <button className="btn btn-primary" onClick={createLine} disabled={busy || !title.trim()}>
                {busy ? '正在开始…' : '开始摸底 →'}
              </button>
            </>
          )}

          {stage === 'goal' && specEdit && (
            <>
              {specEdit.options && specEdit.options.length > 0 && (
                <div className="section">
                  <h4>「{line?.title}」有多个可能的方向，你指的是哪一种？（选定后 AI 按此方向重新生成规格书）</h4>
                  <div className="cat-picker">
                    {specEdit.options.map((opt) => (
                      <button key={opt} type="button" className="cat-option" onClick={() => regenerateSpec(opt)} disabled={busy}>
                        <span className="cat-label" style={{ whiteSpace: 'normal' }}>{opt}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="muted" style={{ margin: 0 }}>
                <b>第一步：目标规格书。</b>AI 把你的模糊目标澄清成了可检验的终局能力定义。你可以修改交付物和成功标准，确认后开始摸底。
              </p>
              <div className="form-row">
                <label>🎯 终局能力目标</label>
                <input
                  type="text"
                  value={specEdit.goal}
                  onChange={(e) => setSpecEdit({ ...specEdit, goal: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>📦 交付物（学完后能拿出什么）</label>
                <textarea
                  rows={2}
                  value={specEdit.deliverable}
                  onChange={(e) => setSpecEdit({ ...specEdit, deliverable: e.target.value })}
                />
              </div>
              <div className="form-row">
                <label>✅ 成功标准（每行一条，可判定达成与否）</label>
                <textarea
                  rows={4}
                  value={specEdit.criteriaText}
                  onChange={(e) => setSpecEdit({ ...specEdit, criteriaText: e.target.value })}
                />
              </div>
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={confirmGoalSpec} disabled={busy}>
                  {busy ? '处理中…' : '确认，开始摸底 →'}
                </button>
                <button className="btn" onClick={() => regenerateSpec()} disabled={busy}>🔄 换一版规格书</button>
              </div>
            </>
          )}

          {stage === 'chat' && (
            <>
              <p className="muted small" style={{ margin: 0 }}>
                摸底对话（{Math.min(session!.round + 1, 3)}/3 轮）——如实回答即可，你的「已掌握」档案会随学习不断更新，现在只是第一版快照。
              </p>
              <div className="chat-log" ref={logRef} style={{ maxHeight: 320, overflowY: 'auto' }}>
                {session!.messages.map((m) => (
                  <div key={m.id} className={'msg ' + m.role}>{m.text}</div>
                ))}
                {busy && <div className="msg ai typing-dots">AI 正在思考</div>}
              </div>
              {session!.round < 3 ? (
                <div className="chat-input-row">
                  <input
                    type="text"
                    placeholder="输入你的回答…"
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && sendAnswer()}
                    disabled={busy}
                  />
                  <button className="btn btn-primary" onClick={sendAnswer} disabled={busy || !input.trim()}>发送</button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                  <button className="btn btn-primary" onClick={() => generateGraph(false)} disabled={busy}>
                    {busy ? '生成中…' : '生成能力图谱 →'}
                  </button>
                  <button className="btn" onClick={() => generateGraph(true)} disabled={busy}>跳过诊断，直接使用图谱</button>
                </div>
              )}
            </>
          )}

          {stage === 'generating' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '30px 0' }}>
              <div className="spinner" />
              <p className="muted">{genMsg || '正在生成…'}</p>
            </div>
          )}

          {stage === 'checklist' && pendingNodes && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                能力图谱已生成（{pendingNodes.length} 个能力节点）。下面是 AI 从中挑出的<b>关键前置能力</b>，勾选<b>已经会的</b>（绿色剪枝）、<b>模糊的</b>（黄色复习）、<b>不会的</b>（正常学习）。
              </p>
              {session!.checklist.map((c) => (
                <div key={c.id} className="checklist-item">
                  <span className="name">{c.name}</span>
                  <div className="seg">
                    <button className={c.state === 'known' ? 'active known' : ''} onClick={() => setItemState(c.id, 'known')}>会</button>
                    <button className={c.state === 'fuzzy' ? 'active fuzzy' : ''} onClick={() => setItemState(c.id, 'fuzzy')}>模糊</button>
                    <button className={c.state === 'unknown' ? 'active unknown' : ''} onClick={() => setItemState(c.id, 'unknown')}>不会</button>
                  </div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={startQuiz} disabled={busy}>
                  {busy ? '出题中…' : '进入诊断测试（AI 出题 + 评分）→'}
                </button>
                <button className="btn" onClick={finishDiagnostic} disabled={busy}>
                  跳过测试，按自评完成（已标记 {knownCount} 项已掌握）
                </button>
              </div>
            </>
          )}

          {stage === 'quiz' && quiz && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                <b>证据式诊断：</b>请认真作答，AI 会按评分要点逐题打分（0~100），分数直接决定这些能力的掌握度。答不上来就写「不会」，比瞎写更诚实。
              </p>
              {quiz.map((q) => {
                const target = pendingNodes?.find((n) => n.id === q.nodeId)
                const score = quizScores?.find((r) => r.nodeId === q.nodeId)
                return (
                  <div key={q.nodeId} className="section">
                    <h4>📝 {target?.name ?? '能力'} {score && <span style={{ color: score.score >= 60 ? '#2e9e5b' : '#c0392b' }}>得分 {score.score}/100</span>}</h4>
                    <p style={{ fontWeight: 600 }}>{q.question}</p>
                    <textarea
                      rows={3}
                      placeholder="写下你的答案…"
                      value={answers[q.nodeId] ?? ''}
                      onChange={(e) => setAnswers({ ...answers, [q.nodeId]: e.target.value })}
                      disabled={!!quizScores}
                    />
                    {score && <p className="muted small">💬 {score.feedback}</p>}
                  </div>
                )
              })}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                {!quizScores ? (
                  <button className="btn btn-primary" onClick={submitQuiz} disabled={busy}>
                    {busy ? '评分中…' : '提交答案，AI 评分'}
                  </button>
                ) : (
                  <button className="btn btn-primary" onClick={finishDiagnostic} disabled={busy}>
                    应用诊断结果，生成我的能力图谱
                  </button>
                )}
                <button className="btn" onClick={finishDiagnostic} disabled={busy}>跳过测试，直接完成</button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
