import type { TreeNode } from '../types'

export interface TreeData {
  root: TreeNode | null
  childrenMap: Map<string, TreeNode[]>
  byId: Map<string, TreeNode>
}

export function buildTree(nodes: TreeNode[]): TreeData {
  const byId = new Map<string, TreeNode>()
  nodes.forEach((n) => byId.set(n.id, n))
  const childrenMap = new Map<string, TreeNode[]>()
  let root: TreeNode | null = null
  nodes.forEach((n) => {
    if (n.parentId && byId.has(n.parentId)) {
      const arr = childrenMap.get(n.parentId) ?? []
      arr.push(n)
      childrenMap.set(n.parentId, arr)
    } else if (!n.parentId) {
      root = n
    }
  })
  childrenMap.forEach((arr) => arr.sort((a, b) => a.createdAt - b.createdAt))
  return { root, childrenMap, byId }
}

export interface LineStats {
  total: number
  mastered: number
  learning: number
  fuzzy: number
  unlearned: number
  pct: number
}

export function computeStats(nodes: TreeNode[]): LineStats {
  const s: LineStats = { total: nodes.length, mastered: 0, learning: 0, fuzzy: 0, unlearned: 0, pct: 0 }
  nodes.forEach((n) => {
    if (n.state === 'mastered') s.mastered++
    else if (n.state === 'learning') s.learning++
    else if (n.state === 'fuzzy') s.fuzzy++
    else s.unlearned++
  })
  s.pct = s.total === 0 ? 0 : Math.round((s.mastered / s.total) * 100)
  return s
}
