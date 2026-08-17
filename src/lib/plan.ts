// ---------- 今日学习计划：一天最少学什么 / 极限挑战（纯逻辑，便于测试） ----------

import type { TreeNode } from '../types'

export type PlanMode = 'minimal' | 'extreme'

export interface PlanItem {
  node: TreeNode
  minutes: number
  /** 为什么选它（用于 UI 展示） */
  reason: string
}

export interface DailyPlan {
  mode: PlanMode
  budgetMinutes: number
  items: PlanItem[]
  totalMinutes: number
  /** 预算剩余（正数）或超支（负数） */
  leftoverMinutes: number
  note: string
}

/** 节点预计学习时长（缺失默认 5 分钟） */
export function nodeMinutes(node: TreeNode): number {
  const m = node.minutes
  return m !== undefined && m > 0 ? m : 5
}

/** 状态优先级：模糊(补漏洞) > 学习中(续上) > 未学(开新) > 已掌握(不选) */
export function statePriority(state: TreeNode['state']): number {
  switch (state) {
    case 'fuzzy':
      return 0
    case 'learning':
      return 1
    case 'unlearned':
      return 2
    default:
      return 3
  }
}

export function stateReason(state: TreeNode['state']): string {
  switch (state) {
    case 'fuzzy':
      return '之前学模糊了，先补牢'
    case 'learning':
      return '正在学，趁热打铁'
    case 'unlearned':
      return '新的原子概念'
    default:
      return ''
  }
}

/**
 * 可选学的节点：自己还没掌握，且父节点（如有）已掌握或没有父节点——
 * 保证计划总是沿着知识树的「前沿」推进，不跳过前置。
 */
export function eligibleNodes(nodes: TreeNode[]): TreeNode[] {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  return nodes.filter((n) => {
    if (n.state === 'mastered') return false
    if (n.parentId === null) return true
    const p = byId.get(n.parentId)
    return p === undefined || p.state === 'mastered'
  })
}

/**
 * 生成今日学习计划。
 * - minimal（最少）：优先补薄弱环节（模糊 > 学习中 > 未学），在预算内挑必须学的；
 *   预算连最高优先级的一项都装不下时，仍保留这一项并提示超支。
 * - extreme（极限）：在预算内塞进尽可能多的节点（优先短节点，同长时优先薄弱环节）。
 */
export function buildDailyPlan(nodes: TreeNode[], budgetMinutes: number, mode: PlanMode): DailyPlan {
  const budget = Math.max(1, Math.round(budgetMinutes))
  const eligible = eligibleNodes(nodes)
  if (eligible.length === 0) {
    return {
      mode,
      budgetMinutes: budget,
      items: [],
      totalMinutes: 0,
      leftoverMinutes: budget,
      note: '这条学习线的概念已经全部掌握 🎉 去「继续分解」或新建学习线吧。'
    }
  }

  const scored = eligible
    .map((n) => ({ node: n, minutes: nodeMinutes(n), priority: statePriority(n.state) }))
    .sort((a, b) => {
      if (mode === 'extreme') {
        if (a.minutes !== b.minutes) return a.minutes - b.minutes
      } else {
        if (a.priority !== b.priority) return a.priority - b.priority
        if (a.minutes !== b.minutes) return a.minutes - b.minutes
      }
      return 0
    })

  let used = 0
  const items: PlanItem[] = []
  for (const s of scored) {
    if (used + s.minutes <= budget || items.length === 0) {
      items.push({ node: s.node, minutes: s.minutes, reason: stateReason(s.node.state) })
      used += s.minutes
      if (used > budget) break
    } else {
      break
    }
  }

  const leftover = budget - used
  const note =
    leftover < 0
      ? '预算不够第一项，先硬啃这一个（挑战自己）。'
      : leftover === 0
        ? '预算刚好用满，冲！'
        : '还剩 ' + leftover + ' 分钟，' + (mode === 'extreme' ? '还想加码就在极限模式里加预算。' : '可以再加一个节点，或留着复盘。')

  return { mode, budgetMinutes: budget, items, totalMinutes: used, leftoverMinutes: leftover, note }
}
