// ---------- 费曼 3×30 的纯逻辑（不碰 UI 与数据库，便于测试） ----------

import { uid } from '../db'
import type { FeynmanSession, FeynmanStage } from '../types'
import { FEYNMAN_STAGES, FEYNMAN_STAGE_MINUTES } from '../types'

/** 每阶段总秒数 */
export function feynmanStageSeconds(stageMinutes: number = FEYNMAN_STAGE_MINUTES): number {
  return Math.max(1, Math.round(stageMinutes)) * 60
}

/** 当前阶段剩余秒数（计时未运行时返回暂存的剩余秒数） */
export function feynmanRemainingSeconds(
  s: Pick<FeynmanSession, 'stageEndsAt' | 'stageRemainingSeconds' | 'stageMinutes'>,
  now: number
): number {
  if (s.stageEndsAt !== null) {
    return Math.max(0, Math.ceil((s.stageEndsAt - now) / 1000))
  }
  return Math.max(0, Math.ceil(s.stageRemainingSeconds))
}

/** 计时是否已在运行 */
export function feynmanTimerRunning(s: Pick<FeynmanSession, 'stageEndsAt'>): boolean {
  return s.stageEndsAt !== null
}

/** 下一阶段；已经是最后一阶段返回 null */
export function feynmanNextStage(stage: FeynmanStage): FeynmanStage | null {
  const i = FEYNMAN_STAGES.indexOf(stage)
  return i >= 0 && i < FEYNMAN_STAGES.length - 1 ? FEYNMAN_STAGES[i + 1] : null
}

/** 新建会话的初始字段 */
export function feynmanSessionInit(lineId: string, nodeId: string, stageMinutes: number = FEYNMAN_STAGE_MINUTES): FeynmanSession {
  const now = Date.now()
  return {
    id: uid(),
    lineId,
    nodeId,
    stage: 'understand',
    status: 'active',
    stageMinutes,
    stageEndsAt: null,
    stageRemainingSeconds: feynmanStageSeconds(stageMinutes),
    retell: '',
    retellFeedback: null,
    tasks: [],
    answers: {},
    answerFeedbacks: {},
    avgScore: 0,
    startedAt: now,
    updatedAt: now
  }
}

/** 会话平均分：复述点评 + 各题评分 的均值；还没有任何评分时返回 0 */
export function feynmanAvgScore(s: Pick<FeynmanSession, 'retellFeedback' | 'answerFeedbacks'>): number {
  const scores: number[] = []
  if (s.retellFeedback) scores.push(s.retellFeedback.score)
  Object.values(s.answerFeedbacks).forEach((f) => scores.push(f.score))
  if (scores.length === 0) return 0
  return Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
}

/**
 * 完成费曼 3×30 后的掌握度加成：
 * 走完全部 3 个阶段 +10，平均分每 10 分再 +1（最高 +10），合计 +10 ~ +20。
 */
export function feynmanCompletionBoost(avgScore: number): number {
  const s = Math.max(0, Math.min(100, Math.round(avgScore)))
  return 10 + Math.round(s / 10)
}
