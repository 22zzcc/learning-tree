import { create } from 'zustand'

export type Tab = 'home' | 'tree' | 'profile' | 'settings'

export interface Toast {
  id: number
  text: string
  kind: 'info' | 'error' | 'success'
}

interface AppState {
  tab: Tab
  activeLineId: string | null
  selectedNodeId: string | null
  focusNodeId: string | null
  toasts: Toast[]
  go: (tab: Tab) => void
  openLine: (id: string) => void
  selectNode: (id: string | null) => void
  setFocus: (id: string | null) => void
  toast: (text: string, kind?: Toast['kind']) => void
  dismissToast: (id: number) => void
}

let toastSeq = 1

export const useAppStore = create<AppState>((set) => ({
  tab: 'home',
  activeLineId: null,
  selectedNodeId: null,
  focusNodeId: null,
  toasts: [],
  go: (tab) => set({ tab }),
  openLine: (id) => set({ activeLineId: id, focusNodeId: null, selectedNodeId: null, tab: 'tree' }),
  selectNode: (id) => set({ selectedNodeId: id }),
  setFocus: (id) => set({ focusNodeId: id, selectedNodeId: id }),
  toast: (text, kind = 'info') => {
    const id = toastSeq++
    set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }))
    setTimeout(() => {
      set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
    }, 4000)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }))
}))
