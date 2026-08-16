// ---------- 核心类型 ----------

export type NodeState = 'unlearned' | 'learning' | 'mastered' | 'fuzzy'

/** 学习线分类 */
export type LineCategory = 'expert' | 'hobby' | 'career'

export interface LearningLine {
  id: string
  title: string        // 学习目标
  reason: string       // 为什么学（摸底时收集）
  /** 分类：expert=六个月专家线 hobby=兴趣爱好线 career=专业所需技术栈线（老数据可能缺失，UI 兜底为 expert） */
  category?: LineCategory
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
  /** 新手最常见的易错点（可选） */
  pitfalls?: string[]
  state: NodeState
  // 从父节点到本节点的「边」：为什么关联 + 相似例子（按需点亮）
  edgeWhy: string | null
  edgeExamples: string[]
  edgeLit: boolean
  createdAt: number
  updatedAt: number
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
  /** 演示数据版本号：升级演示数据时递增，用于老用户刷新 */
  demoVersion: number
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

export interface OnboardingSession {
  id: string
  lineId: string
  stage: 'chat' | 'checklist' | 'generating' | 'done'
  messages: ChatMessage[]
  checklist: ChecklistItem[]
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
