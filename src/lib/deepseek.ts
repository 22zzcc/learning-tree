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

  const buildBody = (includeExtras: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: settings.model || 'deepseek-chat',
      messages,
      max_tokens: opts.maxTokens ?? 4096
    }
    // 已知推理模型（reasoner/r1）不接受 temperature / response_format
    // 未知模型（如 v4-flash / v4-pro）先按支持处理，失败时自动去掉重试
    if (!reasoner && includeExtras) {
      body.temperature = opts.temperature ?? 0.6
      if (opts.json) body.response_format = { type: 'json_object' }
    }
    return body
  }

  const attempt = async (includeExtras: boolean): Promise<string> => {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + settings.apiKey
      },
      body: JSON.stringify(buildBody(includeExtras))
    })
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error('API 请求失败 (' + res.status + ')：' + text.slice(0, 300))
      ;(err as any).httpStatus = res.status
      ;(err as any).responseText = text
      throw err
    }
    const data = await res.json()
    return data?.choices?.[0]?.message?.content ?? ''
  }

  try {
    return await attempt(true)
  } catch (e) {
    const err = e as any
    const retriable = /response_format|temperature|json_object|not support|不支持|invalid parameter/i.test(String(err.responseText ?? ''))
    if (err.httpStatus === 400 && retriable) {
      console.warn('[deepseek] 该模型不接受 JSON/temperature 参数，自动去掉后重试')
      return await attempt(false)
    }
    throw err
  }
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
