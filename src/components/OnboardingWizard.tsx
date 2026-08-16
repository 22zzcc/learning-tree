import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, getSettings } from '../db'
import type { LearningLine, OnboardingSession, TreeNode, LineCategory } from '../types'
import { aiChatQuestion, aiBuildDeepTree, aiBuildChecklistFromTree, isDemoMode } from '../lib/ai'
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
      setSession(sess)
      const q = await aiChatQuestion(newLine, sess)
      const withAi: OnboardingSession = {
        ...sess,
        messages: [{ id: uid(), role: 'ai', text: q, at: Date.now() }]
      }
      await db.onboarding.put(withAi)
      setSession(withAi)
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
      if (skipDiagnostic) {
        await db.nodes.bulkAdd(result.nodes)
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

  /** 应用诊断结果：把已掌握/模糊的能力标记到图谱上，生成个性化树 */
  async function applyDiagnostic() {
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
      await db.nodes.bulkAdd(pendingNodes)
      await db.onboarding.put({ ...session, stage: 'done' })
      toast('你的个性化能力图谱已生成！已掌握的能力已剪枝为绿色', 'success')
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
              <button className="btn btn-primary" onClick={applyDiagnostic} disabled={busy}>
                {busy ? '应用中…' : '应用诊断，生成我的个性化能力图谱（已标记 ' + knownCount + ' 项已掌握）'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
