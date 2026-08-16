import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { ensureDemoSeed } from './lib/demo'
import './styles.css'

async function boot() {
  await ensureDemoSeed()
  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>
  )
}

boot().catch((e) => console.error('启动失败', e))
