import type { Settings } from '../types'

/** 回传给模型的工具调用（OpenAI 兼容线格式，agent 循环用） */
export interface ChatToolCallWire {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface AiChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  /** 工具结果消息回填的调用 id（role: 'tool' 时使用） */
  tool_call_id?: string
  /** 助手消息携带的工具调用（agent 循环使用） */
  tool_calls?: ChatToolCallWire[]
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
  /** 外部取消信号：触发时立即中止请求（用于「取消生成」按钮） */
  signal?: AbortSignal
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
    // 外部取消：立即中止进行中的请求
    const external = opts.signal
    const onAbort = () => controller.abort()
    if (external) {
      if (external.aborted) {
        clearTimeout(timer)
        throw new Error('已取消')
      }
      external.addEventListener('abort', onAbort)
    }
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
      external?.removeEventListener('abort', onAbort)
      if (external?.aborted) {
        throw new Error('已取消')
      }
      if ((e as Error).name === 'AbortError') {
        throw new Error('API 请求超时（' + Math.round(timeoutMs / 1000) + ' 秒无响应，可能模型思考过久或网络问题）')
      }
      throw new Error('API 网络请求失败：' + (e as Error).message)
    }
    clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
    if (!res.ok) {
      const text = await res.text().catch(() => '')
      const err = new Error('API 请求失败 (' + res.status + ')：' + text.slice(0, 300))
      ;(err as any).httpStatus = res.status
      ;(err as any).responseText = text
      throw err
    }
    const data = await res.json()
    // 输出被 max_tokens 截断时 JSON 一定不完整：立即报错而不是返回残缺内容
    if (data?.choices?.[0]?.finish_reason === 'length') {
      throw new Error('API 输出被截断（达到 max_tokens 上限），生成内容不完整')
    }
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

// ---------- 工具调用（function calling）:学习教练 Agent 专用 ----------

/** 模型返回的一次工具调用（已解析） */
export interface ChatToolCall {
  id: string
  name: string
  arguments: string
}

export interface ToolChatResult {
  content: string | null
  toolCalls: ChatToolCall[]
  finishReason: string
  /** 实际应答的模型名 */
  model: string
}

export interface ToolChatOpts extends ChatOpts {
  /** 工具定义（OpenAI 兼容格式） */
  tools?: Array<{ type: 'function'; function: { name: string; description: string; parameters: unknown } }>
}

/**
 * 带工具调用的对话请求（agent 执行循环的单步）。
 * 与 deepseekChat 不同：工具是 agent 循环的前提，模型不支持 tools 时
 * 直接抛出明确错误，而不是悄悄降级成普通对话。
 */
export async function deepseekChatWithTools(
  settings: Settings,
  messages: AiChatMessage[],
  opts: ToolChatOpts = {}
): Promise<ToolChatResult> {
  const url = settings.apiBase.replace(/\/+$/, '') + '/chat/completions'
  const modelName = opts.model || settings.model || 'deepseek-chat'
  const body: Record<string, unknown> = {
    model: modelName,
    messages,
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.6,
    tools: opts.tools ?? [],
    tool_choice: 'auto'
  }
  if (opts.json) body.response_format = { type: 'json_object' }
  if (opts.thinking) body.thinking = { type: opts.thinking }

  const controller = new AbortController()
  const timeoutMs = opts.timeoutMs ?? 120000
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  const external = opts.signal
  const onAbort = () => controller.abort()
  if (external) {
    if (external.aborted) {
      clearTimeout(timer)
      throw new Error('已取消')
    }
    external.addEventListener('abort', onAbort)
  }
  let res: Response
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer ' + settings.apiKey
      },
      body: JSON.stringify(body),
      signal: controller.signal
    })
  } catch (e) {
    clearTimeout(timer)
    external?.removeEventListener('abort', onAbort)
    if (external?.aborted) {
      throw new Error('已取消')
    }
    if ((e as Error).name === 'AbortError') {
      throw new Error('API 请求超时（' + Math.round(timeoutMs / 1000) + ' 秒无响应，可能模型思考过久或网络问题）')
    }
    throw new Error('API 网络请求失败：' + (e as Error).message)
  }
  clearTimeout(timer)
  external?.removeEventListener('abort', onAbort)
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    if (res.status === 400 && /tools|tool_choice|function/i.test(text)) {
      throw new Error('当前模型不支持工具调用（function calling），学习教练无法工作。请在「设置」中把教练模型切换为支持工具调用的模型（如 deepseek-chat / deepseek-reasoner）。')
    }
    const err = new Error('API 请求失败 (' + res.status + ')：' + text.slice(0, 300))
    ;(err as any).httpStatus = res.status
    ;(err as any).responseText = text
    throw err
  }
  const data = await res.json()
  if (data?.choices?.[0]?.finish_reason === 'length') {
    throw new Error('API 输出被截断（达到 max_tokens 上限），生成内容不完整')
  }
  const msg = data?.choices?.[0]?.message
  const toolCalls: ChatToolCall[] = Array.isArray(msg?.tool_calls)
    ? msg.tool_calls
        .filter((t: any) => t?.type === 'function' && t?.function)
        .map((t: any) => ({ id: String(t.id ?? ''), name: String(t.function.name), arguments: String(t.function.arguments ?? '') }))
    : []
  return {
    content: typeof msg?.content === 'string' ? msg.content : null,
    toolCalls,
    finishReason: String(data?.choices?.[0]?.finish_reason ?? ''),
    model: String(data?.model ?? modelName)
  }
}
