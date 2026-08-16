import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid, getSettings } from '../db'
import type { LearningLine, OnboardingSession } from '../types'
import { aiChatQuestion, aiBuildChecklist, aiGenerateTree, isDemoMode } from '../lib/ai'
import { useAppStore } from '../store/appStore'

export default function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const [line, setLine] = useState<LearningLine | null>(null)
  const [session, setSession] = useState<OnboardingSession | null>(null)
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
      const newLine: LearningLine = { id: uid(), title: t, reason: reason.trim(), createdAt: Date.now(), status: 'active' }
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

  async function buildChecklist() {
    if (!line || !session || busy) return
    setBusy(true)
    try {
      const items = await aiBuildChecklist(line, session)
      const updated: OnboardingSession = { ...session, checklist: items, stage: 'checklist' }
      await db.onboarding.put(updated)
      setSession(updated)
    } catch (e) {
      toast('生成清单失败：' + (e as Error).message, 'error')
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

  async function generateTree(skipChecklist = false) {
    if (!line || !session || busy) return
    setBusy(true)
    setGenMsg('AI 正在生成你的知识树骨架（约 10~30 秒）…')
    try {
      const finalSession = skipChecklist ? { ...session, checklist: [], stage: 'generating' as const } : { ...session, stage: 'generating' as const }
      const nodes = await aiGenerateTree(line, finalSession)
      await db.nodes.bulkAdd(nodes)
      await db.onboarding.put({ ...finalSession, stage: 'done' })
      toast('知识树生成完成！共 ' + nodes.length + ' 个概念节点', 'success')
      onClose()
      openLine(line.id)
    } catch (e) {
      toast('生成失败：' + (e as Error).message, 'error')
      setGenMsg('')
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
              <b>演示模式：</b>未配置 API Key，摸底问题与知识树使用内置模板。在「设置」页填入 DeepSeek Key 后即可体验真正的 AI。
            </div>
          )}

          {stage === 'intro' && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                先告诉 AI 你想学什么。接下来它会通过 3 轮问答摸底你的基础，再生成从你的「最近发展区」开始生长的知识树。
              </p>
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
                  placeholder="例如：孩子正在学分数约分，我想先自己弄明白再教他"
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
                摸底对话（{Math.min(session!.round + 1, 3)}/3 轮）——如实回答即可，你的「已掌握」清单会随学习不断更新，现在只是第一版快照。
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
                  <button className="btn btn-primary" onClick={buildChecklist} disabled={busy}>
                    {busy ? '生成中…' : '生成自评清单 →'}
                  </button>
                  <button className="btn" onClick={() => generateTree(true)} disabled={busy}>跳过清单，直接生成知识树</button>
                </div>
              )}
            </>
          )}

          {stage === 'checklist' && (
            <>
              <p className="muted" style={{ margin: 0 }}>
                下面是与「{line?.title}」相关的前置知识点。勾选你<b>已经会的</b>（绿色剪枝）、<b>模糊的</b>（黄色复习）和<b>不会的</b>（正常学习），AI 将据此定制树。
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
              <button className="btn btn-primary" onClick={() => generateTree(false)} disabled={busy}>
                {busy ? '生成中…' : '生成知识树（已标记 ' + knownCount + ' 项已掌握）'}
              </button>
            </>
          )}

          {stage === 'generating' && (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14, padding: '30px 0' }}>
              <div className="spinner" />
              <p className="muted">{genMsg}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
