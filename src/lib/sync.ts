// ---------- 多设备同步：本地优先的「同步文件夹」双向合并 ----------
// 原理：把全部数据导出为 xueshu-sync.json 放到用户选定的同步文件夹（如 OneDrive/坚果云目录），
// 每台设备「同步」时读取远程文件 → 逐表按 id 合并（时间戳新者胜）→ 写回本地 → 再写回文件夹。

import { db, exportAllDataObject, saveSettings, type SyncPayload } from '../db'
import type { Settings } from '../types'

export const SYNC_FILE_NAME = 'xueshu-sync.json'

/** 每张表的「新旧判定」时间字段 */
function mergeTable<T>(local: T[], remote: T[], idOf: (r: T) => string, modAt: (r: T) => number): T[] {
  const map = new Map<string, T>()
  const put = (r: T) => {
    const id = idOf(r)
    const prev = map.get(id)
    if (prev === undefined || modAt(r) >= modAt(prev)) map.set(id, r)
  }
  local.forEach(put)
  remote.forEach(put)
  return [...map.values()]
}

/** settings 表字段级合并：本地优先，本地为空的字段用远程补全；同步元信息取双方较新值 */
function mergeSettings(local: Settings[], remote: Settings[]): Settings[] {
  const l = local.find((s) => s.id === 'app')
  const r = remote.find((s) => s.id === 'app')
  if (!l && !r) return local
  if (!l) return remote
  if (!r) return local
  const merged: Settings = { ...r, ...l }
  // 本地为空的字段用远程补（比如在新设备上，API Key 来自旧设备）
  ;(Object.keys(r) as (keyof Settings)[]).forEach((k) => {
    const lv = merged[k]
    const rv = r[k]
    if (lv === undefined || lv === '' || (Array.isArray(lv) && lv.length === 0) || (typeof lv === 'object' && lv !== null && !Array.isArray(lv) && Object.keys(lv as object).length === 0)) {
      merged[k] = rv as never
    }
  })
  merged.lastSyncAt = Math.max(l.lastSyncAt ?? 0, r.lastSyncAt ?? 0)
  merged.demoVersion = Math.max(l.demoVersion ?? 0, r.demoVersion ?? 0)
  return [merged]
}

/** 双向合并：逐表按 id 合并，时间戳新者胜；无时间戳的表按「信息量」比较 */
export function mergeAllData(local: SyncPayload, remote: SyncPayload | null): SyncPayload {
  if (remote === null) return { ...local, exportedAt: new Date().toISOString() }
  const onboardingMod = (r: { messages?: unknown[] }): number => (r.messages?.length ?? 0)
  return {
    version: 3,
    exportedAt: new Date().toISOString(),
    lines: mergeTable(local.lines, remote.lines, (r) => r.id, (r) => r.createdAt),
    nodes: mergeTable(local.nodes, remote.nodes, (r) => r.id, (r) => r.updatedAt),
    profile: mergeTable(local.profile, remote.profile, (r) => r.id, (r) => r.addedAt),
    settings: mergeSettings(local.settings, remote.settings),
    onboarding: mergeTable(local.onboarding, remote.onboarding, (r) => r.id, onboardingMod),
    feynman: mergeTable(local.feynman, remote.feynman, (r) => r.id, (r) => r.updatedAt),
    activity: mergeTable(local.activity, remote.activity, (r) => r.id, (r) => r.at),
    badges: mergeTable(local.badges, remote.badges, (r) => r.id, (r) => r.unlockedAt)
  }
}

/** 把合并结果整体写入本地数据库（清空后重放） */
export async function applySyncPayload(payload: SyncPayload): Promise<void> {
  const tables = [db.lines, db.nodes, db.profile, db.settings, db.onboarding, db.feynman, db.activity, db.badges]
  await db.transaction('rw', tables, async () => {
    await db.lines.clear()
    await db.nodes.clear()
    await db.profile.clear()
    await db.settings.clear()
    await db.onboarding.clear()
    await db.feynman.clear()
    await db.activity.clear()
    await db.badges.clear()
    await db.lines.bulkAdd(payload.lines)
    await db.nodes.bulkAdd(payload.nodes)
    await db.profile.bulkAdd(payload.profile)
    await db.settings.bulkAdd(payload.settings)
    await db.onboarding.bulkAdd(payload.onboarding)
    await db.feynman.bulkAdd(payload.feynman)
    await db.activity.bulkAdd(payload.activity)
    await db.badges.bulkAdd(payload.badges)
  })
}

export interface SyncSummary {
  /** 远程是否已有同步文件 */
  remoteFound: boolean
  mergedAt: number
}

/** 与选定的同步文件夹做一次双向同步 */
export async function syncWithDirectory(handle: FileSystemDirectoryHandle): Promise<SyncSummary> {
  let remote: SyncPayload | null = null
  try {
    const fh = await handle.getFileHandle(SYNC_FILE_NAME)
    const file = await fh.getFile()
    const parsed = JSON.parse(await file.text()) as SyncPayload
    if (parsed && Array.isArray(parsed.nodes)) remote = parsed
  } catch {
    remote = null // 首次同步：远程还没有文件
  }
  const local = await exportAllDataObject()
  const merged = mergeAllData(local, remote)
  await applySyncPayload(merged)
  const wfh = await handle.getFileHandle(SYNC_FILE_NAME, { create: true })
  const writable = await wfh.createWritable()
  await writable.write(JSON.stringify(merged, null, 2))
  await writable.close()
  const mergedAt = Date.now()
  await saveSettings({ syncFolderName: handle.name, lastSyncAt: mergedAt })
  return { remoteFound: remote !== null, mergedAt }
}
