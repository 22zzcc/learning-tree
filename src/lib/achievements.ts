// ---------- 娱乐激励正反馈闭环：学习打卡 + 成就徽章 ----------

import { db, uid } from '../db'
import type { ActivityEvent, ActivityKind, BadgeRecord } from '../types'

/** 成就判定的输入快照（纯数据，便于测试） */
export interface BadgeSnapshot {
  masteredCount: number
  edgeLitCount: number
  feynmanDoneCount: number
  planExtremeCount: number
  lineDoneCount: number
  streak: number
}

export interface BadgeDefinition {
  id: string
  emoji: string
  name: string
  desc: string
  check: (s: BadgeSnapshot) => boolean
}

export const BADGES: BadgeDefinition[] = [
  { id: 'first-blood', emoji: '🌱', name: '初露锋芒', desc: '掌握第一个概念', check: (s) => s.masteredCount >= 1 },
  { id: 'node-10', emoji: '📚', name: '学而不厌', desc: '掌握 10 个概念', check: (s) => s.masteredCount >= 10 },
  { id: 'node-30', emoji: '🏛️', name: '融会贯通', desc: '掌握 30 个概念', check: (s) => s.masteredCount >= 30 },
  { id: 'edge-first', emoji: '⚡', name: '连点成线', desc: '点亮第一条概念关联', check: (s) => s.edgeLitCount >= 1 },
  { id: 'feynman-first', emoji: '🎓', name: '费曼门徒', desc: '完成第一次费曼 3×30', check: (s) => s.feynmanDoneCount >= 1 },
  { id: 'feynman-5', emoji: '🧠', name: '费曼信徒', desc: '完成 5 次费曼 3×30', check: (s) => s.feynmanDoneCount >= 5 },
  { id: 'streak-3', emoji: '🔥', name: '三日之约', desc: '连续学习 3 天', check: (s) => s.streak >= 3 },
  { id: 'streak-7', emoji: '☄️', name: '七日长征', desc: '连续学习 7 天', check: (s) => s.streak >= 7 },
  { id: 'extreme-first', emoji: '🚀', name: '极限玩家', desc: '生成过一次极限挑战计划', check: (s) => s.planExtremeCount >= 1 },
  { id: 'line-done', emoji: '🏆', name: '大师收官', desc: '掌握一整条学习线的全部概念', check: (s) => s.lineDoneCount >= 1 }
]

export function badgeById(id: string): BadgeDefinition | undefined {
  return BADGES.find((b) => b.id === id)
}

/** 本地时区的日期键（YYYY-MM-DD），用于连续天数统计 */
export function dayKey(t: number): string {
  const d = new Date(t)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return d.getFullYear() + '-' + m + '-' + day
}

/**
 * 连续学习天数：从今天（或昨天，如果今天还没学）开始往回数连续活跃天数。
 * 今天没学但昨天学过 → 连续不断；两天都没学 → 0。
 */
export function computeStreak(activeDays: Set<string>, todayKey: string): number {
  if (activeDays.size === 0) return 0
  const dayBefore = (key: string): string => {
    const d = new Date(key + 'T12:00:00')
    d.setDate(d.getDate() - 1)
    return dayKey(d.getTime())
  }
  const start = activeDays.has(todayKey) ? todayKey : dayBefore(todayKey)
  if (!activeDays.has(start)) return 0
  let cursor = start
  let n = 0
  while (activeDays.has(cursor)) {
    n++
    cursor = dayBefore(cursor)
  }
  return n
}

/** 计算当前数据状态下应该解锁的成就 id（不包含已解锁的） */
export function evaluateBadges(s: BadgeSnapshot, unlockedIds: Set<string>): string[] {
  return BADGES.filter((b) => !unlockedIds.has(b.id) && b.check(s)).map((b) => b.id)
}

/** 从数据库汇总成就判定快照 */
export async function buildBadgeSnapshot(): Promise<BadgeSnapshot> {
  const [nodes, lines, activity] = await Promise.all([
    db.nodes.toArray(),
    db.lines.toArray(),
    db.activity.toArray()
  ])
  const masteredCount = nodes.filter((n) => n.state === 'mastered').length
  const edgeLitCount = nodes.filter((n) => n.edgeLit).length
  const feynmanDoneCount = activity.filter((a) => a.kind === 'feynman-done').length
  const planExtremeCount = activity.filter((a) => a.kind === 'plan-generated' && a.detail === 'extreme').length
  const lineDoneCount = lines.filter((l) => {
    const ns = nodes.filter((n) => n.lineId === l.id)
    return ns.length > 0 && ns.every((n) => n.state === 'mastered')
  }).length
  const streak = computeStreak(new Set(activity.map((a) => dayKey(a.at))), dayKey(Date.now()))
  return { masteredCount, edgeLitCount, feynmanDoneCount, planExtremeCount, lineDoneCount, streak }
}

/** 检查并解锁所有已达成但未解锁的成就，返回本次新解锁的成就 */
export async function unlockDueBadges(): Promise<BadgeDefinition[]> {
  const [snapshot, existing] = await Promise.all([buildBadgeSnapshot(), db.badges.toArray()])
  const due = evaluateBadges(snapshot, new Set(existing.map((b) => b.id)))
  if (due.length === 0) return []
  const now = Date.now()
  await db.badges.bulkAdd(due.map((id) => ({ id, unlockedAt: now }) satisfies BadgeRecord))
  return due.map((id) => badgeById(id)!).filter(Boolean)
}

/** 记录一次学习活动并结算成就；返回本次活动与新解锁的成就 */
export async function recordActivity(kind: ActivityKind, lineId?: string, detail?: string): Promise<{ event: ActivityEvent; unlocks: BadgeDefinition[] }> {
  const event: ActivityEvent = { id: uid(), kind, ...(lineId ? { lineId } : {}), ...(detail ? { detail } : {}), at: Date.now() }
  await db.activity.add(event)
  const unlocks = await unlockDueBadges()
  return { event, unlocks }
}

/** 已解锁成就（按解锁时间排序，含定义） */
export async function getUnlockedBadges(): Promise<{ badge: BadgeDefinition; unlockedAt: number }[]> {
  const rows = await db.badges.toArray()
  return rows
    .sort((a, b) => a.unlockedAt - b.unlockedAt)
    .map((r) => ({ badge: badgeById(r.id)!, unlockedAt: r.unlockedAt }))
    .filter((r) => r.badge !== undefined)
}

/** 今日活跃天数集合（供 UI 与测试复用） */
export function activeDaysOf(events: Pick<ActivityEvent, 'at'>[]): Set<string> {
  return new Set(events.map((e) => dayKey(e.at)))
}
