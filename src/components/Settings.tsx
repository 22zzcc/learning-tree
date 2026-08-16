import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, saveSettings, exportAllData, getSettings } from '../db'
import { useAppStore } from '../store/appStore'
import { deepseekChat } from '../lib/deepseek'

export default function Settings() {
  const settings = useLiveQuery(() => getSettings(), [])
  const toast = useAppStore((s) => s.toast)
  const [testing, setTesting] = useState(false)
  const [draft, setDraft] = useState<{ apiKey: string; apiBase: string; model: string; depth: 'standard' | 'deep' } | null>(null)

  if (!settings) return <div className="muted">加载中…</div>

  const s = draft ?? { apiKey: settings.apiKey, apiBase: settings.apiBase, model: settings.model, depth: settings.depth }

  async function commit(patch: Partial<typeof s>) {
    const next = { ...s, ...patch }
    setDraft(next)
    await saveSettings(patch)
    toast('设置已保存', 'success')
  }

  async function testConnection() {
    setTesting(true)
    try {
      const cur = await getSettings()
      const answer = await deepseekChat(
        cur,
        [{ role: 'user', content: '请回复四个字：连接成功' }],
        { temperature: 0 }
      )
      toast('测试成功，AI 回复：' + answer.slice(0, 40), 'success')
    } catch (e) {
      toast('连接失败：' + (e as Error).message, 'error')
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
          <label>模型（deepseek-chat = 普通模型，快；deepseek-reasoner = 推理模型，知识分解更深入、原理讲得更透，但更慢）</label>
          <select
            value={s.model}
            onChange={(e) => {
              const next = { ...s, model: e.target.value }
              setDraft(next)
              commit({ model: e.target.value })
            }}
            style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', fontSize: 14, background: '#fff', color: 'var(--ink)' }}
          >
            <option value="deepseek-chat">deepseek-chat（默认，快）</option>
            <option value="deepseek-reasoner">deepseek-reasoner（推理模型，更深入）</option>
          </select>
          <p className="muted small" style={{ margin: '4px 0 0' }}>
            其他 OpenAI 兼容模型可在这里临时改回文本后填写；不填 apiBase 时默认走 DeepSeek 官方接口。
          </p>
        </div>
        <div className="form-row">
          <label>知识树分解深度</label>
          <div className="seg" style={{ alignSelf: 'flex-start' }}>
            <button
              className={s.depth === 'standard' ? 'active known' : ''}
              onClick={() => commit({ depth: 'standard' })}
            >
              标准（3~5 层，15~40 节点）
            </button>
            <button
              className={s.depth === 'deep' ? 'active known' : ''}
              onClick={() => commit({ depth: 'deep' })}
            >
              深度（5~8 层，40~150 节点，分支不设上限）
            </button>
          </div>
        </div>
        <div>
          <button className="btn" onClick={testConnection} disabled={testing || !s.apiKey}>
            {testing ? '测试中…' : '测试连接'}
          </button>
        </div>
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
        <h3>ℹ️ 关于 1.0</h3>
        <p className="muted small" style={{ marginTop: 0 }}>
          当前版本聚焦「目标摸底 → 知识树 → 图片导出」主线。后续版本规划：费曼 3×30 学习流程、弹性时长与挑战模式、
          娱乐激励正反馈、复述笔记本与周复盘、高维认知解读。
        </p>
      </div>
    </div>
  )
}
