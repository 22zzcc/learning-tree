import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db'
import { useAppStore } from '../store/appStore'
import { moduleModel } from '../lib/ai'
import { runCoachAgent, runDemoCoach } from '../lib/agent/core'
import { COACH_TOOLS } from '../lib/agent/tools'
import type { CoachMessage, CoachStep } from '../types'

const SUGGESTIONS = [
  '帮我安排今天的学习计划(30 分钟)',
  '我现在有哪些薄弱概念?',
  '给我出 3 道诊断题',
  '总结一下我本周的学习情况'
]

export default function Coach() {
  const messages = useLiveQuery(() => db.coach.orderBy('at').toArray(), [])
  const settings = useLiveQuery(() => db.settings.get('app'), [])
  const go = useAppStore((s) => s.go)
  const toast = useAppStore((s) => s.toast)
  const [input, setInput] = useState('')
  const [running, setRunning] = useState(false)
  /** 正在执行的回答的实时步骤(null = 没有执行中) */
  const [liveSteps, setLiveSteps] = useState<CoachStep[] | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const logRef = useRef<HTMLDivElement>(null)

  const demo = settings !== undefined && !settings.apiKey

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight })
  }, [messages, liveSteps])

  async function send(text?: string) {
    const content = (text ?? input).trim()
    if (!content || running || settings === undefined) return
    await db.coach.add({ id: uid(), role: 'user', text: content, at: Date.now() })
    setInput('')
    setRunning(true)
    const steps: CoachStep[] = []
    setLiveSteps([])
    const onStep = (s: CoachStep) => {
      steps.push(s)
      setLiveSteps([...steps])
    }
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const history = await db.coach.orderBy('at').toArray()
      const out = settings.apiKey
        ? await runCoachAgent({
            settings,
            history,
            tools: COACH_TOOLS,
            model: moduleModel(settings, 'coach'),
            signal: controller.signal,
            onStep
          })
        : await runDemoCoach(history, onStep)
      await db.coach.add({ id: uid(), role: 'assistant', text: out.answer, steps, model: out.model, at: Date.now() })
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      if (msg === '已取消') {
        toast('已停止生成', 'info')
      } else {
        toast(msg, 'error')
        await db.coach.add({ id: uid(), role: 'assistant', text: '抱歉,教练遇到问题:' + msg, steps, at: Date.now() })
      }
    } finally {
      abortRef.current = null
      setRunning(false)
      setLiveSteps(null)
    }
  }

  function stop() {
    abortRef.current?.abort()
  }

  async function clearAll() {
    if (!window.confirm('清空与学习教练的全部对话?')) return
    await db.coach.clear()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      void send()
    }
  }

  return (
    <div className="coach">
      <div className="coach-head">
        <div>
          <h1>🤖 学习教练</h1>
          <p className="muted" style={{ margin: '4px 0 0' }}>
            带工具的 Agent:会自己查你的知识树、档案与计划,规划 → 调工具 → 多步执行,直到完成任务。
          </p>
        </div>
        <button className="btn btn-sm" onClick={clearAll} disabled={!messages || messages.length === 0 || running}>
          🗑 清空对话
        </button>
      </div>

      {demo && (
        <div className="coach-demo-banner">
          <span>⚡ 演示模式:未配置 API Key,教练按规则回答(不联网、不自由对话)。</span>
          <button className="btn btn-sm" onClick={() => go('settings')}>
            去配置 Key
          </button>
        </div>
      )}

      {messages && messages.length === 0 && !running && (
        <div className="coach-chips">
          <span className="muted small">试试问:</span>
          {SUGGESTIONS.map((s) => (
            <button key={s} className="coach-chip" onClick={() => void send(s)}>
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="coach-log" ref={logRef}>
        {messages?.map((m) => <CoachMessageView key={m.id} m={m} />)}
        {running && (
          <div className="coach-bubble-ai">
            {liveSteps && liveSteps.length > 0 && <StepsView steps={liveSteps} live />}
            <div className="coach-running-ind">
              <span className="spinner" />
              教练正在执行{liveSteps && liveSteps.length > 0 ? '(已执行 ' + liveSteps.length + ' 步)' : ''},可点「停止」中断
            </div>
          </div>
        )}
      </div>

      <div className="coach-input-row">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={'问教练任何学习问题,例如:' + SUGGESTIONS[0] + '(Enter 发送,Shift+Enter 换行)'}
          rows={2}
        />
        {running ? (
          <button className="btn btn-danger" onClick={stop}>
            ⏹ 停止
          </button>
        ) : (
          <button className="btn btn-primary" onClick={() => void send()} disabled={!input.trim()}>
            发送
          </button>
        )}
      </div>
      <p className="muted small" style={{ margin: '6px 0 0' }}>
        对话与执行步骤保存在本机浏览器;教练的回答基于你应用里的真实学习数据。
      </p>
    </div>
  )
}

function CoachMessageView({ m }: { m: CoachMessage }) {
  if (m.role === 'user') {
    return <div className="msg user">{m.text}</div>
  }
  return (
    <div className="coach-bubble-ai">
      <div className="msg ai">{m.text}</div>
      {m.steps && m.steps.length > 0 && <StepsView steps={m.steps} />}
      {m.model && <div className="coach-model small">模型:{m.model}</div>}
    </div>
  )
}

/** 一条 assistant 消息的执行步骤轨迹(思考 + 工具调用) */
function StepsView({ steps, live }: { steps: CoachStep[]; live?: boolean }) {
  return (
    <div className="coach-steps">
      {steps.map((s, i) => {
        if (s.kind === 'think') {
          return (
            <div key={i} className="coach-think">
              💭 {s.text}
            </div>
          )
        }
        if (s.kind === 'error') {
          return (
            <div key={i} className="coach-step coach-step-err">
              ⚠️ {s.text}
            </div>
          )
        }
        return (
          <details key={i} className={'coach-step' + (s.ok === false ? ' coach-step-fail' : '')} open={live === true}>
            <summary>
              <span className="coach-step-icon">{s.ok === false ? '❌' : '🔧'}</span>
              <span className="coach-step-name">{s.toolName}</span>
              <span className="coach-step-args">{truncate(s.toolArgs ?? '', 80)}</span>
            </summary>
            <div className="coach-step-result">{s.toolResult ?? '(无结果)'}</div>
          </details>
        )
      })}
    </div>
  )
}

function truncate(s: string, n: number): string {
  const one = s.replace(/\s+/g, ' ')
  return one.length > n ? one.slice(0, n) + '…' : one
}
