// ---------- 学习教练 Agent 执行循环 ----------
// 真实模式:OpenAI 兼容的 function calling 循环(思考 → 调工具 → 观察结果 → 再思考)。
// 演示模式(未配置 API Key):按关键词意图走规则,但同样调用真实工具查真实数据。

import type { Settings, CoachMessage, CoachStep } from '../../types'
import { deepseekChatWithTools, type AiChatMessage } from '../deepseek'
import { buildCoachSystemPrompt } from './prompt'
import { executeCoachTool } from './tools'
import type { AgentTool, CoachRunResult } from './types'

/** 最多允许的「模型→工具」往返轮数 */
export const MAX_TOOL_ROUNDS = 8

export interface RunCoachOptions {
  settings: Settings
  /** 完整对话历史(仅 user/assistant 文本) */
  history: CoachMessage[]
  tools: AgentTool[]
  /** 覆盖模型(默认跟随设置里的 coach 模块/全局模型) */
  model?: string
  signal?: AbortSignal
  /** 每产生一个步骤(思考/工具结果)立即回调,用于界面流式展示 */
  onStep: (step: CoachStep) => void
}

/**
 * 真实 agent 循环:带工具反复请求模型,直到模型直接给出最终回答。
 */
export async function runCoachAgent(opts: RunCoachOptions): Promise<CoachRunResult> {
  const { settings, history, tools, signal, onStep } = opts
  const model = opts.model || settings.model || 'deepseek-chat'
  const messages: AiChatMessage[] = [
    { role: 'system', content: buildCoachSystemPrompt(tools) },
    ...history.map((m) => ({ role: m.role, content: m.text }))
  ]
  const defs = tools.map((t) => ({
    type: 'function' as const,
    function: { name: t.name, description: t.description, parameters: t.parameters }
  }))

  let lastModel = model
  for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
    const res = await deepseekChatWithTools(settings, messages, { model, tools: defs, signal, timeoutMs: 180000 })
    lastModel = res.model

    // 模型不再调用工具 → 这就是最终回答
    if (res.toolCalls.length === 0) {
      const answer = (res.content ?? '').trim()
      if (!answer) throw new Error('模型没有返回回答内容,请重试')
      return { answer, model: lastModel }
    }

    // 带工具调用的一轮:先记录思考文字
    if (res.content?.trim()) onStep({ kind: 'think', text: res.content.trim() })
    messages.push({
      role: 'assistant',
      content: res.content,
      tool_calls: res.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: c.arguments } }))
    })

    // 逐个执行工具,把结果回填
    for (const call of res.toolCalls) {
      let result: string
      let ok = true
      try {
        const args = JSON.parse(call.arguments || '{}')
        result = await executeCoachTool(call.name, args)
      } catch (e) {
        ok = false
        result = '工具执行失败:' + (e as Error).message
      }
      onStep({ kind: 'tool', toolName: call.name, toolArgs: call.arguments, toolResult: result, ok })
      messages.push({ role: 'tool', content: result, tool_call_id: call.id })
    }
  }

  // 轮次用尽:去掉工具做一次总结,强制产出最终回答
  messages.push({ role: 'user', content: '工具调用轮次已达上限。请基于上面的全部工具结果,直接给出最终回答,不要再次调用工具。' })
  const res = await deepseekChatWithTools(settings, messages, { model, tools: [], signal, timeoutMs: 180000 })
  return { answer: (res.content ?? '').trim() || '(模型没有返回内容)', model: res.model }
}

/**
 * 演示模式教练(无 API Key):按关键词意图走规则,仍然调用真实工具查真实数据,
 * 保证「不联网也能体验 agent 多步执行」。
 */
export async function runDemoCoach(history: CoachMessage[], onStep: (step: CoachStep) => void): Promise<CoachRunResult> {
  const q = [...history].reverse().find((m) => m.role === 'user')?.text ?? ''
  const step = async (toolName: string, args: Record<string, unknown>): Promise<string> => {
    const result = await executeCoachTool(toolName, args)
    onStep({ kind: 'tool', toolName, toolArgs: JSON.stringify(args), toolResult: result, ok: true })
    return result
  }

  const budgetMatch = q.match(/(\d+)\s*分钟/)
  const budget = budgetMatch ? Number(budgetMatch[1]) : 30

  const DEMO_PREFIX = '（演示模式:教练未连接 AI,按规则执行真实工具）\n\n'

  if (/计划|今天学|复习|安排|学什么/.test(q)) {
    await step('list_learning_lines', {})
    const result = await step('get_today_plan', { budgetMinutes: budget, mode: /极限|最多|加码/.test(q) ? 'extreme' : 'minimal' })
    return { answer: DEMO_PREFIX + result + '\n\n配置 DeepSeek API Key 后,我可以自由对话并按你的情况定制计划。', model: 'demo-coach' }
  }
  if (/测验|测试|考题|出题|考考/.test(q)) {
    const result = await step('make_quiz', { count: 3 })
    return { answer: DEMO_PREFIX + result + '\n\n把答案写出来发给我,配置 Key 后我会逐题评分。', model: 'demo-coach' }
  }
  if (/薄弱|模糊|短板|不会|查漏|补/.test(q)) {
    const result = await step('get_tree_status', {})
    return { answer: DEMO_PREFIX + '你的薄弱环节如下:\n\n' + result + '\n\n建议:先补 🟡模糊 的概念,再续 🟠学习中 的。', model: 'demo-coach' }
  }
  if (/统计|成就|连续|复盘|周报|本周|学得怎么样/.test(q)) {
    const result = await step('get_learning_stats', {})
    return { answer: DEMO_PREFIX + result, model: 'demo-coach' }
  }
  if (/档案|我会|掌握.*(什么|哪些)|会什么/.test(q)) {
    const result = await step('get_knowledge_profile', {})
    return { answer: DEMO_PREFIX + result, model: 'demo-coach' }
  }

  // 兜底:展示能力范围
  await step('list_learning_lines', {})
  return {
    answer:
      DEMO_PREFIX +
      '我可以帮你做这些事:\n' +
      '1. 生成今日学习计划 —— 「帮我安排今天学 30 分钟」\n' +
      '2. 找出薄弱概念 —— 「我有哪些薄弱点?」\n' +
      '3. 出一套诊断测验 —— 「给我出 3 道题」\n' +
      '4. 查看学习统计 —— 「本周学得怎么样?」\n\n' +
      '配置 DeepSeek API Key(设置页)后,我能自由对话、自主组合工具、多步执行任意学习任务。',
    model: 'demo-coach'
  }
}
