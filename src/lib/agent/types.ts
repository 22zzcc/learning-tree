// ---------- 学习教练 Agent 的类型 ----------

/** 学习教练可调用的一个工具 */
export interface AgentTool {
  name: string
  /** 一句话说明（会进 system prompt 和模型上下文，务必说清参数语义） */
  description: string
  /** 参数 JSON Schema（OpenAI 兼容） */
  parameters: Record<string, unknown>
  /**
   * 执行工具，返回给模型看的文本结果。
   * 抛出的错误会被执行循环捕获并包装成「工具执行失败」回给模型，让模型自我修正。
   */
  execute: (args: Record<string, unknown>) => Promise<string>
}

/** 一次 agent 运行的最终产出 */
export interface CoachRunResult {
  answer: string
  model: string
}
