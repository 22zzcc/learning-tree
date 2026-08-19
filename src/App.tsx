import { useEffect, useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { db } from './db'
import type { LineCategory } from './types'
import { useAppStore, type Tab } from './store/appStore'
import Home from './components/Home'
import TreeView from './components/TreeView'
import Profile from './components/Profile'
import Review from './components/Review'
import Coach from './components/Coach'
import Settings from './components/Settings'
import OnboardingWizard from './components/OnboardingWizard'
import FeynmanStudy from './components/FeynmanStudy'

const TABS: { id: Tab; label: string }[] = [
  { id: 'home', label: '🏠 学习线' },
  { id: 'tree', label: '🌳 知识树' },
  { id: 'profile', label: '🧠 我会什么' },
  { id: 'review', label: '📓 复盘' },
  { id: 'coach', label: '🤖 教练' },
  { id: 'settings', label: '⚙️ 设置' }
]

function EmptyTreePrompt() {
  const go = useAppStore((s) => s.go)
  return (
    <div className="empty-state">
      <div className="empty-emoji">🌳</div>
      <h2>还没有打开任何学习线</h2>
      <p>回到「学习线」选一条进入，或新建一条学习线开始 AI 摸底。</p>
      <button className="btn btn-primary" onClick={() => go('home')}>回到学习线</button>
    </div>
  )
}

export default function App() {
  const tab = useAppStore((s) => s.tab)
  const go = useAppStore((s) => s.go)
  const activeLineId = useAppStore((s) => s.activeLineId)
  const openLine = useAppStore((s) => s.openLine)
  const toasts = useAppStore((s) => s.toasts)
  const dismissToast = useAppStore((s) => s.dismissToast)
  const feynman = useAppStore((s) => s.feynman)
  const closeFeynman = useAppStore((s) => s.closeFeynman)
  const [showWizard, setShowWizard] = useState(false)
  const [wizardCategory, setWizardCategory] = useState<LineCategory>('expert')
  const lines = useLiveQuery(() => db.lines.toArray(), [])
  const booted = useRef(false)

  // 支持 URL 深链：?tab=tree&line=<id> 直接打开某条学习线的知识树
  useEffect(() => {
    if (booted.current || !lines) return
    booted.current = true
    const params = new URLSearchParams(location.search)
    if (params.get('tab') === 'tree') {
      const lid = params.get('line')
      const target = lines.find((l) => l.id === lid) ?? lines[0]
      if (target) openLine(target.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lines])

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand" onClick={() => go('home')} title="回到学习线总览">
          🌳 学树 <span className="brand-sub">交互式知识树学习助手</span>
        </div>
        <nav className="tabs">
          {TABS.map((t) => (
            <button key={t.id} className={'tab' + (tab === t.id ? ' active' : '')} onClick={() => go(t.id)}>
              {t.label}
            </button>
          ))}
        </nav>
      </header>
      <main className={'main' + (tab === 'tree' ? ' main-tree' : '')}>
        {tab === 'home' && (
          <Home
            onNewLine={(cat) => {
              setWizardCategory(cat)
              setShowWizard(true)
            }}
          />
        )}
        {tab === 'tree' && (activeLineId ? <TreeView lineId={activeLineId} /> : <EmptyTreePrompt />)}
        {tab === 'profile' && <Profile />}
        {tab === 'review' && <Review />}
        {tab === 'coach' && <Coach />}
        {tab === 'settings' && <Settings />}
      </main>
      {showWizard && <OnboardingWizard initialCategory={wizardCategory} onClose={() => setShowWizard(false)} />}
      {feynman && <FeynmanStudy lineId={feynman.lineId} nodeId={feynman.nodeId} onClose={closeFeynman} />}
      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={'toast toast-' + t.kind} onClick={() => dismissToast(t.id)} title="点击关闭">
            {t.text}
          </div>
        ))}
      </div>
    </div>
  )
}
