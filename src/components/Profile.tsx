import { useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db, uid } from '../db'
import { useAppStore } from '../store/appStore'
import { STATE_COLOR } from '../types'

export default function Profile() {
  const lines = useLiveQuery(() => db.lines.toArray(), [])
  const nodes = useLiveQuery(() => db.nodes.toArray(), [])
  const manual = useLiveQuery(() => db.profile.where('source').equals('manual').toArray(), [])
  const toast = useAppStore((s) => s.toast)
  const [name, setName] = useState('')
  const [note, setNote] = useState('')

  if (!lines || !nodes || !manual) return <div className="muted">加载中…</div>

  const mastered = nodes.filter((n) => n.state === 'mastered')
  const fuzzy = nodes.filter((n) => n.state === 'fuzzy')

  async function addManual() {
    const n = name.trim()
    if (!n) {
      toast('先写一个知识点或技能', 'error')
      return
    }
    await db.profile.add({ id: uid(), name: n, note: note.trim(), source: 'manual', addedAt: Date.now() })
    setName('')
    setNote('')
    toast('已加入「我会什么」', 'success')
  }

  async function changeNodeState(id: string, state: 'fuzzy' | 'unlearned' | 'mastered') {
    await db.nodes.update(id, { state, updatedAt: Date.now() })
    if (state === 'fuzzy') toast('已标记为模糊，记得回头复习', 'info')
    else if (state === 'mastered') toast('已重新标记为掌握', 'success')
    else toast('已移出「我会什么」', 'info')
  }

  async function removeManual(id: string) {
    await db.profile.delete(id)
  }

  const lineTitle = (id: string) => lines.find((l) => l.id === id)?.title ?? '手动添加'

  return (
    <div>
      <h1>🧠 我会什么</h1>
      <p className="muted">
        这是你的动态知识档案：每学会一个概念它会自动长大，忘了可以降级为「模糊」。它不是一次摸底就定死的快照，而是随学习不断迭代的活档案。
      </p>

      <div className="profile-stats">
        <div className="card stat-card">
          <div className="stat-num">{mastered.length}</div>
          <div className="stat-label">已掌握概念</div>
        </div>
        <div className="card stat-card">
          <div className="stat-num" style={{ color: '#d4a017' }}>{fuzzy.length}</div>
          <div className="stat-label">有点模糊（待复习）</div>
        </div>
        <div className="card stat-card">
          <div className="stat-num">{manual.length}</div>
          <div className="stat-label">手动添加的技能</div>
        </div>
        <div className="card stat-card">
          <div className="stat-num">{lines.length}</div>
          <div className="stat-label">并行学习线</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 10px' }}>＋ 手动添加（书里学的、生活里会的都行）</h3>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="知识点或技能，如：会骑自行车"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addManual()}
            style={{ flex: '2 1 200px' }}
          />
          <input
            type="text"
            placeholder="备注（可选）"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addManual()}
            style={{ flex: '2 1 200px' }}
          />
          <button className="btn btn-primary" onClick={addManual}>添加</button>
        </div>
      </div>

      {fuzzy.length > 0 && (
        <div className="card" style={{ marginBottom: 16 }}>
          <h3 style={{ margin: '0 0 10px' }}>🟡 有点模糊，建议回头复习</h3>
          {fuzzy.map((n) => (
            <div key={n.id} className="entry-row">
              <span className="dot" style={{ background: STATE_COLOR.fuzzy }} />
              <span className="name">{n.name}</span>
              <span className="note">{lineTitle(n.lineId)}</span>
              <button className="btn btn-sm" onClick={() => changeNodeState(n.id, 'mastered')}>又学会了</button>
              <button className="btn btn-danger btn-sm" onClick={() => changeNodeState(n.id, 'unlearned')}>移出</button>
            </div>
          ))}
        </div>
      )}

      <div className="card" style={{ marginBottom: 16 }}>
        <h3 style={{ margin: '0 0 10px' }}>🟢 已掌握</h3>
        {mastered.length === 0 && <p className="muted">还没有已掌握的概念，去知识树里学第一个吧。</p>}
        {mastered.map((n) => (
          <div key={n.id} className="entry-row">
            <span className="dot" style={{ background: STATE_COLOR.mastered }} />
            <span className="name">{n.name}</span>
            <span className="note">{lineTitle(n.lineId)}</span>
            <button className="btn btn-sm" onClick={() => changeNodeState(n.id, 'fuzzy')}>标为模糊</button>
            <button className="btn btn-danger btn-sm" onClick={() => changeNodeState(n.id, 'unlearned')}>移出</button>
          </div>
        ))}
      </div>

      {manual.length > 0 && (
        <div className="card">
          <h3 style={{ margin: '0 0 10px' }}>✍️ 手动添加</h3>
          {manual.map((m) => (
            <div key={m.id} className="entry-row">
              <span className="dot" style={{ background: '#5b8dd6' }} />
              <span className="name">{m.name}</span>
              <span className="note">{m.note}</span>
              <button className="btn btn-danger btn-sm" onClick={() => removeManual(m.id)}>删除</button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
