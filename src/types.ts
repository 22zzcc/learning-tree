// ---------- 核心类型 ----------

export type NodeState = 'unlearned' | 'learning' | 'mastered' | 'fuzzy'

/** 学习线分类 */
export type LineCategory = 'expert' | 'hobby' | 'career'

/** 生成溯源：这棵树到底是谁生成的、怎么生成的 */
export interface GenerationMeta {
  source: 'ai' | 'demo'
  model: string
  generatedAt: number
  skeletonAttempts: number
  decompositionCalls: number
  stopReason: 'frontier_exhausted' | 'budget_exceeded' | 'max_nodes_exceeded' | 'skeleton_only' | 'demo_mode'
  complete: boolean
  /** 骨架请求总耗时（毫秒） */
  skeletonMs?: number
  /** 本次生成中每个模块实际调用的模型（用于验证「各模块独立调用」是否生效） */
  modelsUsed?: Partial<Record<AiModule, string>>
}

export interface LearningLine {
  id: string
  title: string        // 学习目标
  reason: string       // 为什么学（摸底时收集）
  /** 分类：expert=六个月专家线 hobby=兴趣爱好线 career=专业所需技术栈线（老数据可能缺失，UI 兜底为 expert） */
  category?: LineCategory
  /** 生成溯源（这棵树由谁生成） */
  generation?: GenerationMeta
  createdAt: number
  status: 'active' | 'done'
}

export interface TreeNode {
  id: string
  lineId: string
  parentId: string | null   // null = 树根（即学习目标本身）
  name: string
  definition: string
  example: string
  whyImportant: string
  /** 通俗原理：这个知识点为什么成立 / 为什么这样设计（可选） */
  principle?: string
  /** 新手最常见的易错点（可选，已停止生成） */
  pitfalls?: string[]
  /** 预计学习时长（分钟）；原子单元 ≤ 90 */
  minutes?: number
  /** 独立测试 / 掌握标准：通过什么能证明学会了 */
  test?: string
  /** 最小实践任务 */
  practice?: string
  /** 掌握度 0~100（可选；缺省时按 state 推导） */
  mastery?: number
  state: NodeState
  // 从父节点到本节点的「边」：为什么关联 + 相似例子（按需点亮）
  edgeWhy: string | null
  edgeExamples: string[]
  edgeLit: boolean
  /** 高维认知解读：认知升级后对同一概念的重新理解（按需生成） */
  highDim?: HighDimNote
  createdAt: number
  updatedAt: number
}

/** 高维认知解读记录 */
export interface HighDimNote {
  text: string
  model: string
  /** 生成时用户已掌握的概念数 */
  masteredCount: number
  at: number
}

export interface ProfileEntry {
  id: string
  name: string
  note: string
  source: string        // 'manual' 或某条学习线的 id
  addedAt: number
}

export type DecomposeDepth = 'standard' | 'deep'

export interface Settings {
  id: string
  apiKey: string
  apiBase: string
  model: string
  /** 知识树分解深度：standard = 3~5 层/15~40 节点；deep = 5~8 层/40~150 节点、分支不设上限 */
  depth: DecomposeDepth
  /** 各 AI 模块的模型覆盖；缺省时跟随全局 model */
  models?: Partial<Record<AiModule, string>>
  /** 骨架 JSON 序列化关闭思考模式（V4 混合思考模型：结构化输出更快更稳） */
  skeletonNoThinking: boolean
  /** 自动/手动分解关闭思考模式（拆分既有知识不需要长思考，速度提升 5~10 倍） */
  decomposeNoThinking: boolean
  /** 演示数据版本号：升级演示数据时递增，用于老用户刷新 */
  demoVersion: number
}

/** 使用 AI 的功能模块 */
export type AiModule = 'chat' | 'checklist' | 'skeleton' | 'decompose' | 'lightEdge' | 'feynman' | 'review' | 'highdim'

export const AI_MODULE_LABELS: Record<AiModule, string> = {
  chat: '摸底聊天（新建学习线时的 3 轮问答）',
  checklist: '诊断清单（从能力图谱挑关键前置能力）',
  skeleton: '能力图谱骨架（生成大类与章节）',
  decompose: '深度分解（自动/手动拆到原子单元）',
  lightEdge: '边点亮（概念间的例子与为什么）',
  feynman: '费曼反馈（复述点评 + 应用出题与评分）',
  review: '每周复盘（学习数据总结与下周建议）',
  highdim: '高维认知解读（认知升级后重新理解同一知识）'
}

export interface ChatMessage {
  id: string
  role: 'user' | 'ai'
  text: string
  at: number
}

export interface ChecklistItem {
  id: string
  name: string
  state: 'known' | 'fuzzy' | 'unknown'
}

/** 目标规格书：Goal Specification 阶段的产出 */
export interface GoalSpec {
  goal: string
  deliverable: string
  criteria: string[]
}

export interface OnboardingSession {
  id: string
  lineId: string
  stage: 'goal' | 'chat' | 'checklist' | 'quiz' | 'generating' | 'done'
  messages: ChatMessage[]
  checklist: ChecklistItem[]
  /** 目标规格书（澄清模糊目标后的终局能力定义） */
  goalSpec?: GoalSpec
  round: number          // 已进行的聊天轮数（共 3 轮）
}

export const STATE_LABEL: Record<NodeState, string> = {
  unlearned: '未学',
  learning: '学习中',
  mastered: '已掌握',
  fuzzy: '模糊'
}

export const STATE_COLOR: Record<NodeState, string> = {
  unlearned: '#93a29d',
  learning: '#e8930c',
  mastered: '#2e9e5b',
  fuzzy: '#d4a017'
}

export const STATE_BG: Record<NodeState, string> = {
  unlearned: '#ffffff',
  learning: '#fff9ef',
  mastered: '#eef8f2',
  fuzzy: '#fdf9ec'
}

/** 四档状态对应的默认掌握度（百分比） */
export const STATE_MASTERY: Record<NodeState, number> = {
  unlearned: 0,
  learning: 45,
  mastered: 90,
  fuzzy: 25
}

/** 由掌握度百分比推导状态档位 */
export function stateFromMastery(m: number): NodeState {
  if (m >= 85) return 'mastered'
  if (m >= 30) return 'learning'
  if (m >= 5) return 'fuzzy'
  return 'unlearned'
}

// ---------- 娱乐激励正反馈闭环 ----------

/** 学习活动类型（用于打卡连续天数与成就解锁） */
export type ActivityKind = 'node-mastered' | 'edge-lit' | 'feynman-done' | 'plan-generated'

export interface ActivityEvent {
  id: string
  kind: ActivityKind
  /** 所在学习线（可选） */
  lineId?: string
  /** 附加信息（如计划模式 extreme/minimal） */
  detail?: string
  at: number
}

/** 已解锁的成就 */
export interface BadgeRecord {
  id: string
  unlockedAt: number
}

// ---------- 费曼学习法 3×30 ----------

/** 费曼三阶段：理解 → 复述 → 举例应用 */
export type FeynmanStage = 'understand' | 'retell' | 'apply'

export const FEYNMAN_STAGES: FeynmanStage[] = ['understand', 'retell', 'apply']

export const FEYNMAN_STAGE_LABEL: Record<FeynmanStage, string> = {
  understand: '理解',
  retell: '复述',
  apply: '举例应用'
}

/** 每阶段默认时长（分钟）：3 阶段 × 30 分钟 */
export const FEYNMAN_STAGE_MINUTES = 30

/** AI 点评结果（复述点评与答题评分共用） */
export interface FeynmanFeedback {
  /** 0~100 */
  score: number
  /** 讲得好 / 答得对的地方 */
  strengths: string[]
  /** 遗漏点 / 错误点（费曼法核心：找出缺口） */
  gaps: string[]
  /** 下一步建议 */
  suggestion: string
}

/** 举例应用阶段的一道应用场景题 */
export interface FeynmanTask {
  id: string
  question: string
  hint?: string
}

/** 一条费曼 3×30 学习会话（每个节点一条，可中断续学） */
export interface FeynmanSession {
  id: string
  lineId: string
  nodeId: string
  stage: FeynmanStage
  status: 'active' | 'done'
  /** 每阶段分钟数（默认 30，为后续「弹性时长」预留） */
  stageMinutes: number
  /** 当前阶段倒计时截止时间戳（毫秒）；null = 计时未在运行 */
  stageEndsAt: number | null
  /** 暂停/未开始时的剩余秒数，恢复计时时转为 stageEndsAt */
  stageRemainingSeconds: number
  /** 复述原文（用户提交的最新一版） */
  retell: string
  retellFeedback: FeynmanFeedback | null
  /** 应用阶段题目（进入阶段时生成） */
  tasks: FeynmanTask[]
  /** 每道题的用户答案 */
  answers: Record<string, string>
  /** 每道题的 AI 评分 */
  answerFeedbacks: Record<string, FeynmanFeedback>
  /** 完成时的平均分（复述点评与各题评分的均值） */
  avgScore: number
  startedAt: number
  updatedAt: number
}
