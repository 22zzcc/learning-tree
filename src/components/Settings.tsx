import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saveSettings, exportAllData, getSettings } from '../db'
import { useAppStore } from '../store/appStore'
import { deepseekChat } from '../lib/deepseek'
import { moduleModel } from '../lib/ai'
import { syncWithDirectory } from '../lib/sync'
import { AI_MODULE_LABELS, type AiModule } from '../types'

export default function Settings() {
  const settings = useLiveQuery(() => getSettings(), [])
  const toast = useAppStore((s) => s.toast)
  const [testing, setTesting] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [draft, setDraft] = useState<{ apiKey: string; apiBase: string; model: string; depth: 'standard' | 'deep' } | null>(null)

  if (!settings) return <div className="muted">加载中…</div>

  const s = draft ?? { apiKey: settings.apiKey, apiBase: settings.apiBase, model: settings.model, depth: settings.depth }

  async function commit(patch: Partial<typeof s>) {
    const next = { ...s, ...patch }
    setDraft(next)
    await saveSettings(patch)
    toast('设置已保存', 'success')
  }

  async function commitModuleModel(mod: AiModule, value: string) {
    const next: Record<string, string> = { ...(settings?.models ?? {}) }
    if (value) next[mod] = value
    else delete next[mod]
    await saveSettings({ models: next })
    toast('「' + AI_MODULE_LABELS[mod] + '」的模型已更新', 'success')
  }

  /** 测试连接：测的是「骨架生成」实际使用的模型（moduleModel 解析），与真实生成路径一致 */
  async function testConnection() {
    setTesting(true)
    try {
      const cur = await getSettings()
      const model = moduleModel(cur, 'skeleton')
      const answer = await deepseekChat(
        cur,
        [{ role: 'user', content: '请回复四个字：连接成功' }],
        { temperature: 0, model, maxTokens: 20 }
      )
      toast('骨架模型（' + model + '）连接成功，AI 回复：' + answer.slice(0, 40), 'success')
    } catch (e) {
      toast('骨架模型连接失败：' + (e as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  /** 测试全部 5 个模块各自解析出的模型 */
  async function testAllModels() {
    setTesting(true)
    try {
      const cur = await getSettings()
      const mods: AiModule[] = Object.keys(AI_MODULE_LABELS) as AiModule[]
      const results = await Promise.all(
        mods.map(async (m) => {
          const model = moduleModel(cur, m)
          try {
            await deepseekChat(cur, [{ role: 'user', content: '回复：ok' }], { temperature: 0, model, maxTokens: 10 })
            return m + '（' + model + '）✅'
          } catch (e) {
            return m + '（' + model + '）❌ ' + (e as Error).message.slice(0, 50)
          }
        })
      )
      const ok = results.every((r) => r.includes('✅'))
      toast('各模块模型测试：' + results.join('｜'), ok ? 'success' : 'error')
    } catch (e) {
      toast('测试失败：' + (e as Error).message, 'error')
    } finally {
      setTesting(false)
    }
  }

  async function exportData() {
    const json = await exportAllData()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = '学树-数据备份-' + new Date().toISOString().slice(0, 10) + '.json'
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    toast('已导出全部数据', 'success')
  }

  async function clearAll() {
    if (!window.confirm('确定清空全部数据（学习线、知识树、档案、设置）？此操作不可恢复。')) return
    await db.delete()
    location.reload()
  }

  async function pickSyncFolder() {
    const w = window as unknown as { showDirectoryPicker?: (o?: { mode?: string }) => Promise<{ name: string }> }
    if (!w.showDirectoryPicker) {
      toast('当前浏览器不支持文件夹访问，请用 Chrome / Edge 桌面版', 'error')
      return
    }
    try {
      const handle = await w.showDirectoryPicker({ mode: 'readwrite' })
      await db.kv.put({ id: 'sync-dir', handle })
      await saveSettings({ syncFolderName: handle.name })
      toast('同步文件夹已选择：' + handle.name + '（建议选云盘同步目录）', 'success')
    } catch (e) {
      if ((e as { name?: string })?.name !== 'AbortError') toast('选择文件夹失败：' + (e as Error).message, 'error')
    }
  }

  async function syncNow() {
    const row = await db.kv.get('sync-dir')
    const handle = row?.handle as (FileSystemDirectoryHandle & { queryPermission?: (o: { mode: string }) => Promise<string>; requestPermission?: (o: { mode: string }) => Promise<string> }) | undefined
    if (!handle) {
      toast('请先选择同步文件夹', 'error')
      return
    }
    if (handle.queryPermission && handle.requestPermission) {
      if ((await handle.queryPermission({ mode: 'readwrite' })) !== 'granted') {
        if ((await handle.requestPermission({ mode: 'readwrite' })) !== 'granted') {
          toast('需要文件夹读写权限才能同步', 'error')
          return
        }
      }
    }
    setSyncBusy(true)
    try {
      const summary = await syncWithDirectory(handle)
      toast('同步完成：' + (summary.remoteFound ? '已与远程文件双向合并' : '已首次导出同步文件') + '，以后每台设备点「立即同步」即可', 'success')
    } catch (e) {
      toast('同步失败：' + (e as Error).message, 'error')
    } finally {
      setSyncBusy(false)
    }
  }

  return (
    <div>
      <h1>⚙️ 设置</h1>

      {!settings.apiKey && (
        <div className="demo-banner" style={{ marginBottom: 18 }}>
          <b>当前为演示模式：</b>未配置 API Key，知识树使用内置模板生成。在{' '}
          <a href="https://platform.deepseek.com" target="_blank" rel="noreferrer">platform.deepseek.com</a>{' '}
          注册并创建 Key 后填入下方，即可获得真正的 AI 摸底与个性化知识树。
        </div>
      )}

      <div className="card settings-block">
        <h3>🤖 AI 接口（DeepSeek）</h3>
        <div className="form-row">
          <label>API Key（仅保存在本机浏览器）</label>
          <input
            type="password"
            placeholder="sk-..."
            value={s.apiKey}
            onChange={(e) => setDraft({ ...s, apiKey: e.target.value })}
            onBlur={() => commit({ apiKey: s.apiKey })}
          />
        </div>
        <div className="form-row">
          <label>接口地址</label>
          <input
            type="text"
            value={s.apiBase}
            onChange={(e) => setDraft({ ...s, apiBase: e.target.value })}
            onBlur={() => commit({ apiBase: s.apiBase })}
          />
        </div>
        <div className="form-row">
          <label>模型</label>
          <select
            value={s.model}
            onChange={(e) => {
              const next = { ...s, model: e.target.value }
              setDraft(next)
              commit({ model: e.target.value })
            }}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 14, background: '#fff', color: 'var(--ink)' }}
          >
            <option value="deepseek-chat">deepseek-chat（DeepSeek 官方，快）</option>
            <option value="deepseek-reasoner">deepseek-reasoner（推理模型，分解更深入）</option>
            <option value="deepseek-v4-flash">deepseek-v4-flash</option>
            <option value="deepseek-v4-pro">deepseek-v4-pro</option>
          </select>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            deepseek-chat / deepseek-reasoner 默认走 DeepSeek 官方接口；deepseek-v4-flash / deepseek-v4-pro 需要把上面的「接口地址」改成提供该模型的服务地址。模型不支持 JSON 模式时会自动降级重试，无需额外设置。
          </p>
        </div>
        <div className="form-row">
          <label>知识树分解深度</label>
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            <button
              className={s.depth === 'standard' ? 'active known' : ''}
              onClick={() => commit({ depth: 'standard' })}
            >
              标准（3~5 层，15~40 节点，不做自动深拆）
            </button>
            <button
              className={s.depth === 'deep' ? 'active known' : ''}
              onClick={() => commit({ depth: 'deep' })}
            >
              深度（自动分解到不能再拆，上限约 300 节点）
            </button>
          </div>
        </div>
        <div className="form-row">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.skeletonNoThinking !== false}
              onChange={(e) => saveSettings({ skeletonNoThinking: e.target.checked }).then(() => toast('已保存', 'success'))}
              style={{ width: 'auto' }}
            />
            骨架 JSON 序列化关闭思考模式（结构化输出更快更稳，推荐）
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={settings.decomposeNoThinking !== false}
              onChange={(e) => saveSettings({ decomposeNoThinking: e.target.checked }).then(() => toast('已保存', 'success'))}
              style={{ width: 'auto' }}
            />
            自动深度分解关闭思考模式（拆分既有知识不需要长思考，速度提升 5~10 倍，推荐；拆解质量要求极高时可关闭此开关）
          </label>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={testConnection} disabled={testing || !s.apiKey}>
            {testing ? '测试中…' : '测试连接（骨架模型）'}
          </button>
          <button className="btn" onClick={testAllModels} disabled={testing || !s.apiKey}>
            {testing ? '测试中…' : '测试全部 ' + Object.keys(AI_MODULE_LABELS).length + ' 个模块的模型'}
          </button>
        </div>
      </div>

      <div className="card settings-block">
        <h3>🧩 各模块 AI 模型</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          每个模块可以单独指定模型；选择「跟随默认」时使用上面的全局模型（当前：{settings.model}）。
        </p>
        {(Object.keys(AI_MODULE_LABELS) as AiModule[]).map((mod) => (
          <div key={mod} className="form-row">
            <label>
              {AI_MODULE_LABELS[mod]}——当前生效：{settings.models?.[mod] || settings.model}
            </label>
            <select
              value={settings.models?.[mod] ?? ''}
              onChange={(e) => commitModuleModel(mod, e.target.value)}
              style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 14, background: '#fff', color: 'var(--ink)' }}
            >
              <option value="">跟随默认（{settings.model}）</option>
              <option value="deepseek-chat">deepseek-chat（官方，快）</option>
              <option value="deepseek-reasoner">deepseek-reasoner（推理模型）</option>
              <option value="deepseek-v4-flash">deepseek-v4-flash</option>
              <option value="deepseek-v4-pro">deepseek-v4-pro</option>
            </select>
          </div>
        ))}
      </div>

      <div className="card settings-block">
        <h3>💾 数据</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          所有数据（学习线、知识树、知识档案）都保存在本机浏览器的 IndexedDB 中，不上传任何服务器。
        </p>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={exportData}>导出全部数据（JSON）</button>
          <button className="btn btn-danger" onClick={clearAll}>清空全部数据</button>
        </div>
      </div>

      <div className="card settings-block">
        <h3>🌐 多设备同步</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          选择一个云盘同步目录（如 OneDrive / 坚果云文件夹），点「立即同步」把全部数据写为{' '}
          <code>xueshu-sync.json</code>；在另一台设备选同一个文件夹再同步一次即完成双向合并
          （每张表按 id 合并、后修改的胜出，API Key 也会带过去）。
        </p>
        {settings.syncFolderName && (
          <p className="muted small">
            📁 同步文件夹：{settings.syncFolderName}
            {settings.lastSyncAt ? ' · 上次同步：' + new Date(settings.lastSyncAt).toLocaleString() : ''}
          </p>
        )}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <button className="btn" onClick={pickSyncFolder}>
            {settings.syncFolderName ? '更换同步文件夹' : '选择同步文件夹'}
          </button>
          <button className="btn btn-primary" onClick={syncNow} disabled={syncBusy || !settings.syncFolderName}>
            {syncBusy ? '同步中…' : '立即同步'}
          </button>
        </div>
      </div>

      <div className="card settings-block">
        <h3>ℹ️ 关于</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          当前版本：1.0 主线（目标摸底 → 知识树 → 图片导出）+ 2.0 完整路线图（费曼 3×30、
          弹性时长与挑战模式、娱乐激励正反馈、复述笔记本与周复盘、高维认知解读、多设备同步）。
        </p>
      </div>
    </div>
  )
}
