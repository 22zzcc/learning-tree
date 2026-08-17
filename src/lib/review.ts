// ---------- 复述笔记本 + 每周复盘：周统计纯逻辑（便于测试） ----------

import type { ActivityEvent, FeynmanSession } from '../types'

/** 一周（周一 00:00 起）的学习统计 */
export interface WeekStats {
  nodeMastered: number
  edgeLit: number
  feynmanDone: number
  planGenerated: number
  /** 本周完成费曼会话的平均分（0 表示本周没有完成记录） */
  avgFeynmanScore: number
  /** 当前连续学习天数 */
  streak: number
}

/** 本周一 00:00 的时间戳（本地时区） */
export function weekStart(now: number): number {
  const d = new Date(now)
  const sinceMonday = (d.getDay() + 6) % 7
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - sinceMonday)
  return d.getTime()
}

/** 按活动日志 + 费曼会话汇总本周统计 */
export function computeWeekStats(events: ActivityEvent[], sessions: FeynmanSession[], streak: number, now: number): WeekStats {
  const start = weekStart(now)
  const inWeek = events.filter((e) => e.at >= start)
  const counts = { nodeMastered: 0, edgeLit: 0, feynmanDone: 0, planGenerated: 0 }
  inWeek.forEach((e) => {
    if (e.kind === 'node-mastered') counts.nodeMastered++
    else if (e.kind === 'edge-lit') counts.edgeLit++
    else if (e.kind === 'feynman-done') counts.feynmanDone++
    else if (e.kind === 'plan-generated') counts.planGenerated++
  })
  const doneScores = sessions
    .filter((s) => s.status === 'done' && s.avgScore > 0 && s.updatedAt >= start)
    .map((s) => s.avgScore)
  const avgFeynmanScore = doneScores.length === 0 ? 0 : Math.round(doneScores.reduce((a, b) => a + b, 0) / doneScores.length)
  return { ...counts, avgFeynmanScore, streak }
}

/** 周标签：2026-08-17 ~ 08-23 */
export function weekLabel(now: number): string {
  const start = weekStart(now)
  const end = start + 6 * 24 * 3600 * 1000
  const fmt = (t: number) => {
    const d = new Date(t)
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
  }
  return fmt(start) + ' ~ ' + fmt(end)
}
