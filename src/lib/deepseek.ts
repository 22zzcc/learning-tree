import type { Settings } from '../types'

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export async function deepseekChat(
  settings: Settings,
  messages: AiChatMessage[],
  opts: { json?: boolean; temperature?: number } = {}
): Promise<string> {
  const url = settings.apiBase.replace(/\/+$/, '') + '/chat/completions'
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: 'Bearer ' + settings.apiKey
    },
    body: JSON.stringify({
      model: settings.model || 'deepseek-chat',
      messages,
      temperature: opts.temperature ?? 0.6,
      max_tokens: 4096,
      ...(opts.json ? { response_format: { type: 'json_object' } } : {})
    })
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
