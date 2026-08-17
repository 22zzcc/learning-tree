import Dexie, { type Table } from 'dexie'
import type { LearningLine, TreeNode, ProfileEntry, Settings, OnboardingSession, FeynmanSession, ActivityEvent, BadgeRecord } from './types'

export class LearnTreeDB extends Dexie {
  lines!: Table<LearningLine, string>
  nodes!: Table<TreeNode, string>
  profile!: Table<ProfileEntry, string>
  settings!: Table<Settings, string>
  onboarding!: Table<OnboardingSession, string>
  feynman!: Table<FeynmanSession, string>
  activity!: Table<ActivityEvent, string>
  badges!: Table<BadgeRecord, string>
  /** 通用键值（存同步文件夹的 FileSystemDirectoryHandle 等不可导出对象） */
  kv!: Table<{ id: string; handle?: unknown }, string>

  constructor() {
    super('xueshu-learning-tree')
    this.version(1).stores({
      lines: 'id, createdAt',
      nodes: 'id, lineId, parentId, state',
      profile: 'id, source, addedAt',
      settings: 'id',
      onboarding: 'id, lineId'
    })
    // v2：费曼 3×30 学习会话
    this.version(2).stores({
      lines: 'id, createdAt',
      nodes: 'id, lineId, parentId, state',
      profile: 'id, source, addedAt',
      settings: 'id',
      onboarding: 'id, lineId',
      feynman: 'id, lineId, nodeId, status, updatedAt'
    })
    // v3：激励闭环——学习活动日志 + 成就
    this.version(3).stores({
      lines: 'id, createdAt',
      nodes: 'id, lineId, parentId, state',
      profile: 'id, source, addedAt',
      settings: 'id',
      onboarding: 'id, lineId',
      feynman: 'id, lineId, nodeId, status, updatedAt',
      activity: 'id, kind, lineId, at',
      badges: 'id, unlockedAt'
    })
    // v4：多设备同步——通用键值表（同步文件夹句柄）
    this.version(4).stores({
      lines: 'id, createdAt',
      nodes: 'id, lineId, parentId, state',
      profile: 'id, source, addedAt',
      settings: 'id',
      onboarding: 'id, lineId',
      feynman: 'id, lineId, nodeId, status, updatedAt',
      activity: 'id, kind, lineId, at',
      badges: 'id, unlockedAt',
      kv: 'id'
    })
  }
}

export const db = new LearnTreeDB()

export function uid(): string {
  return crypto.randomUUID()
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app')
  if (!s) {
    return {
      id: 'app',
      apiKey: '',
      apiBase: 'https://api.deepseek.com',
      model: 'deepseek-chat',
      depth: 'deep',
      models: {},
      skeletonNoThinking: true,
      decomposeNoThinking: true,
      demoVersion: 0
    }
  }
  // 老数据归一化：新加的布尔开关缺省时按「开启」处理（undefined !== false → true）
  return {
    ...s,
    skeletonNoThinking: s.skeletonNoThinking !== false,
    decomposeNoThinking: s.decomposeNoThinking !== false
  }
}

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings()
  await db.settings.put({ ...cur, ...patch, id: 'app' })
}

/** 全量数据负载（导出 / 同步共用） */
export interface SyncPayload {
  version: 3
  exportedAt: string
  lines: LearningLine[]
  nodes: TreeNode[]
  profile: ProfileEntry[]
  settings: Settings[]
  onboarding: OnboardingSession[]
  feynman: FeynmanSession[]
  activity: ActivityEvent[]
  badges: BadgeRecord[]
}

export async function exportAllDataObject(): Promise<SyncPayload> {
  const [lines, nodes, profile, settings, onboarding, feynman, activity, badges] = await Promise.all([
    db.lines.toArray(),
    db.nodes.toArray(),
    db.profile.toArray(),
    db.settings.toArray(),
    db.onboarding.toArray(),
    db.feynman.toArray(),
    db.activity.toArray(),
    db.badges.toArray()
  ])
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    lines,
    nodes,
    profile,
    settings,
    onboarding,
    feynman,
    activity,
    badges
  }
}

export async function exportAllData(): Promise<string> {
  return JSON.stringify(await exportAllDataObject(), null, 2)
}
