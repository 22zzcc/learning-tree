import type { Settings } from '../types'

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOpts {
  json?: boolean
  temperature?: number
  maxTokens?: number
}

export function isReasonerModel(model: string): boolean {
  return model.includes('reasoner') || model.includes('r1')
}

export async function deepseekChat(
  settings: Settings,
  messages: AiChatMessage[],
  opts: ChatOpts = {}
): Promise<string> {
  const url = settings.apiBase.replace(/\/+$/, '') + '/chat/completions'
  const reasoner = isReasonerModel(settings.model || 'deepseek-chat')
  const body: Record<string, unknown> = {
    model: settings.model || 'deepseek-chat',
    messages,
    max_tokens: opts.maxTokens ?? 4096
  }
  // 推理模型不接受 temperature / response_format，由 prompt + 提取器保证 JSON
  if (!reasoner) {
    body.temperature = opts.temperature ?? 0.6
    if (opts.json) body.response_format = { type: 'json_object' }
  }
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey
    },
    body: JSON.stringify(body)
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error('API 请求失败 (' + res.status + ')：' + text.slice(0, 300))
  }
  const data = await res.json()
  return data?.choices?.[0]?.message?.content ?? ''
}

/** 从 AI 返回的文本中提取 JSON（兼容代码块包裹的情况） */
export function extractJson<T = unknown>(text: string): T {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const raw = fenced ? fenced[1] : text
  const start = raw.indexOf('{')
  const end = raw.lastIndexOf('}')
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('AI 返回的内容不是有效的 JSON')
  }
  return JSON.parse(raw.slice(start, end + 1)) as T
}
