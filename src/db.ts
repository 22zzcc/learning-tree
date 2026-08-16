import Dexie, { type Table } from 'dexie'
import type { LearningLine, TreeNode, ProfileEntry, Settings, OnboardingSession } from './types'

export class LearnTreeDB extends Dexie {
  lines!: Table<LearningLine, string>
  nodes!: Table<TreeNode, string>
  profile!: Table<ProfileEntry, string>
  settings!: Table<Settings, string>
  onboarding!: Table<OnboardingSession, string>

  constructor() {
    super('xueshu-learning-tree')
    this.version(1).stores({
      lines: 'id, createdAt',
      nodes: 'id, lineId, parentId, state',
      profile: 'id, source, addedAt',
      settings: 'id',
      onboarding: 'id, lineId'
    })
  }
}

export const db = new LearnTreeDB()

export function uid(): string {
  return crypto.randomUUID()
}

export async function getSettings(): Promise<Settings> {
  const s = await db.settings.get('app')
  return s ?? {
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

export async function saveSettings(patch: Partial<Settings>): Promise<void> {
  const cur = await getSettings()
  await db.settings.put({ ...cur, ...patch, id: 'app' })
}

export async function exportAllData(): Promise<string> {
  const [lines, nodes, profile, settings, onboarding] = await Promise.all([
    db.lines.toArray(),
    db.nodes.toArray(),
    db.profile.toArray(),
    db.settings.toArray(),
    db.onboarding.toArray()
  ])
  return JSON.stringify(
    { version: 1, exportedAt: new Date().toISOString(), lines, nodes, profile, settings, onboarding },
    null,
    2
  )
}
