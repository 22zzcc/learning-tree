import type { Settings } from '../types'

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

export interface ChatOpts {
  json?: boolean
  temperature?: number
  maxTokens?: number
  /** 覆盖全局模型（按模块单独配置时使用） */
  model?: string
  /** V4 混合思考模型：thinking.type = enabled/disabled；缺省时跟随模型默认 */
  thinking?: 'enabled' | 'disabled'
  /** 请求超时（毫秒），默认 120 秒；超时会报错而不是无限转圈 */
  timeoutMs?: number
}

/**
 * @deprecated V4 系列是混合思考模型，不能再靠名称猜是否是推理模型；
 * 统一改为「先按支持发送参数，失败时自动降级重试」。
 */
export function isReasonerModel(model: string): boolean {
  return model.includes('reasoner') || model.includes('r1')
}

export async function deepseekChat(
  settings: Settings,
  messages: AiChatMessage[],
  opts: ChatOpts = {}
): Promise<string> {
  const url = settings.apiBase.replace(/\/+$/, '') + '/chat/completions'
  const modelName = opts.model || settings.model || 'deepseek-chat'

  const buildBody = (includeExtras: boolean): Record<string, unknown> => {
    const body: Record<string, unknown> = {
      model: modelName,
      messages,
      max_tokens: opts.maxTokens ?? 4096
    }
    if (includeExtras) {
      body.temperature = opts.temperature ?? 0.6
      if (opts.json) body.response_format = { type: 'json_object' }
      if (opts.thinking) body.thinking = { type: opts.thinking }
    }
    return body
  }

  const attempt = async (includeExtras: boolean): Promise<string> => {
    const controller = new AbortController()
    const timeoutMs = opts.timeoutMs ?? 120000
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let res: Response
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + settings.apiKey
        },
        body: JSON.stringify(buildBody(includeExtras)),
        signal: controller.signal
      })
    } catch (e) {
      clearTimeout(timer)
      if ((e as Error).name === 'AbortError') {
        throw new Error('API 请求超时（' + Math.round(timeoutMs / 1000) + ' 秒无响应，可能模型思考过久或网络问题）')
      }
      throw new Error('API 网络请求失败：' + (e as Error).message)
    }
    clearTimeout(timer)
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
    const retriable = /response_format|temperature|json_object|thinking|not support|不支持|invalid parameter/i.test(String(err.responseText ?? ''))
    if (err.httpStatus === 400 && retriable) {
      console.warn('[deepseek] 模型不接受 JSON/temperature/thinking 参数，自动去掉后重试')
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
