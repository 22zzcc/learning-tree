// ---------- 核心类型 ----------

export type NodeState = 'unlearned' | 'learning' | 'mastered' | 'fuzzy'

export interface LearningLine {
  id: string
  title: string        // 学习目标
  reason: string       // 为什么学（摸底时收集）
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

export interface Settings {
  id: string
  apiKey: string
  apiBase: string
  model: string
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
  learning: '#fff6e5',
  mastered: '#e9f7ef',
  fuzzy: '#fdf8e3'
}
