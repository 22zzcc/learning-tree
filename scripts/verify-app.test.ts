// ---------- 端到端验证：用 fake-indexeddb + jsdom 跑真实生产代码 ----------
import './fake-idb-setup'
import { JSDOM } from 'jsdom'
import { writeFileSync } from 'node:fs'
import * as d3 from 'd3'
import { db, uid } from '../src/db'
import { ensureDemoSeed, demoTreeSpec, removeMistakeNodes } from '../src/lib/demo'
import { buildTree, computeStats } from '../src/lib/treeUtils'
import { renderTree } from '../src/lib/renderTree'
import { aiLightEdge, aiDecomposeNode } from '../src/lib/ai'

console.log('[debug] globalThis.indexedDB =', typeof (globalThis as any).indexedDB)

const dom = new JSDOM('<!doctype html><html><body><svg id="s"></svg></body></html>')
const win = dom.window as any
// Node 里没有 DOM 全局，d3-zoom 等需要它们
;(globalThis as any).window = win
;(globalThis as any).document = win.document
;(globalThis as any).SVGElement = win.SVGElement
;(globalThis as any).SVGSVGElement = win.SVGSVGElement
;(globalThis as any).Element = win.Element
const document = win.document
const svgEl = document.getElementById('s') as unknown as SVGSVGElement
const XMLSerializer = win.XMLSerializer

async function main() {
let pass = 0
let fail = 0
function check(name: string, cond: boolean, extra?: string) {
  if (cond) {
    pass++
    console.log('  PASS  ' + name)
  } else {
    fail++
    console.log('  FAIL  ' + name + (extra ? '  [' + extra + ']' : ''))
  }
}

const noop = () => {}

// ---- 1. 播种与数据 ----
await ensureDemoSeed()
const lines = await db.lines.toArray()
check('播种 3 条演示学习线', lines.length === 3, 'got ' + lines.length)
check(
  '三条演示线各占一个分类轨道',
  lines.every((l) => !!l.category) && new Set(lines.map((l) => l.category)).size === 3,
  JSON.stringify(lines.map((l) => l.category))
)
const allNodes = await db.nodes.toArray()
check('播种 36 个演示节点（16+7+13）', allNodes.length === 36, 'got ' + allNodes.length)

const sd = lines.find((l) => l.title === '掌握短除法')!
const sdNodes = allNodes.filter((n) => n.lineId === sd.id)
check('短除法线 16 个节点', sdNodes.length === 16, 'got ' + sdNodes.length)
const td = buildTree(sdNodes)
check('根节点是「掌握短除法」', td.root?.name === '掌握短除法', td.root?.name)

const stats = computeStats(sdNodes)
check(
  '统计正确（已掌握4/学习中3/模糊2/未学7）',
  stats.mastered === 4 && stats.learning === 3 && stats.fuzzy === 2 && stats.unlearned === 7 && stats.pct === 25,
  JSON.stringify(stats)
)

// ---- 2. 整树渲染 ----
renderTree({
  svgEl,
  root: td.root!,
  childrenMap: td.childrenMap,
  collapsed: new Set(),
  selectedId: td.root!.id,
  transform: d3.zoomIdentity,
  fitRoot: true,
  onSelect: noop,
  onToggleCollapse: noop,
  onFocus: noop,
  onBackgroundClick: noop,
  onTransformChange: noop
})
check('渲染出 16 个节点', svgEl.querySelectorAll('g.node').length === 16, 'got ' + svgEl.querySelectorAll('g.node').length)
check('渲染出 15 条边', svgEl.querySelectorAll('path.link').length === 15, 'got ' + svgEl.querySelectorAll('path.link').length)
check('渲染出 9 条已点亮边的「为什么」标签', svgEl.querySelectorAll('text.edge-label').length === 9, 'got ' + svgEl.querySelectorAll('text.edge-label').length)
check('根节点带选中描边', (svgEl.querySelector('g.node rect')?.getAttribute('stroke-width') ?? '') === '3')
const toggles = svgEl.querySelectorAll('circle.collapse-toggle')
check('有子节点的节点带折叠按钮（6 个）', toggles.length === 6, 'got ' + toggles.length)
check('所有边路径非空', [...svgEl.querySelectorAll('path.link')].every((p) => (p.getAttribute('d') ?? '').length > 10))

// 保存整树 SVG 供人工查看
writeFileSync('demo-tree-full.svg', new XMLSerializer().serializeToString(svgEl))
console.log('  INFO  已输出 demo-tree-full.svg')

// ---- 3. 折叠 ----
const firstChild = td.childrenMap.get(td.root!.id)![0] // 除法基本概念（带 2 个子节点）
renderTree({
  svgEl,
  root: td.root!,
  childrenMap: td.childrenMap,
  collapsed: new Set([firstChild.id]),
  selectedId: null,
  transform: d3.zoomIdentity,
  fitRoot: true,
  onSelect: noop,
  onToggleCollapse: noop,
  onFocus: noop,
  onBackgroundClick: noop,
  onTransformChange: noop
})
check('折叠「除法基本概念」后剩 14 个节点', svgEl.querySelectorAll('g.node').length === 14, 'got ' + svgEl.querySelectorAll('g.node').length)

// ---- 4. 聚焦子树 ----
const sub = td.childrenMap.get(td.root!.id)![2] // 竖式除法（长除法），子树 3 节点
renderTree({
  svgEl,
  root: sub,
  childrenMap: td.childrenMap,
  collapsed: new Set(),
  selectedId: sub.id,
  transform: d3.zoomIdentity,
  fitRoot: true,
  onSelect: noop,
  onToggleCollapse: noop,
  onFocus: noop,
  onBackgroundClick: noop,
  onTransformChange: noop
})
check('聚焦「竖式除法」渲染 3 个节点', svgEl.querySelectorAll('g.node').length === 3, 'got ' + svgEl.querySelectorAll('g.node').length)
writeFileSync('demo-tree-focus.svg', new XMLSerializer().serializeToString(svgEl))
console.log('  INFO  已输出 demo-tree-focus.svg')

// ---- 5. 点亮一条未点亮的边（演示模式 AI） ----
const applyNode = sdNodes.find((n) => n.name === '短除法的应用')!
const yf = sdNodes.find((n) => n.name === '分数约分')!
check('「分数约分」边初始未点亮', yf.edgeLit === false)
const lit = await aiLightEdge(applyNode, yf)
check('演示模式点亮边返回 why + 2 个例子', !!lit.edgeWhy && lit.edgeExamples.length >= 2, JSON.stringify(lit))
await db.nodes.update(yf.id, { edgeWhy: lit.edgeWhy, edgeExamples: lit.edgeExamples, edgeLit: true })
const updated = await db.nodes.get(yf.id)
check('边状态已写入数据库', updated?.edgeLit === true)
// 模拟真实应用行为：useLiveQuery 重新查询数据库拿到新数据再渲染
const freshTd = buildTree(await db.nodes.where('lineId').equals(sd.id).toArray())
renderTree({
  svgEl,
  root: freshTd.root!,
  childrenMap: freshTd.childrenMap,
  collapsed: new Set(),
  selectedId: yf.id,
  transform: d3.zoomIdentity,
  fitRoot: true,
  onSelect: noop,
  onToggleCollapse: noop,
  onFocus: noop,
  onBackgroundClick: noop,
  onTransformChange: noop
})
check('点亮后标签数变 10', svgEl.querySelectorAll('text.edge-label').length === 10, 'got ' + svgEl.querySelectorAll('text.edge-label').length)

// ---- 6. 并行线独立性 ----
const sw = lines.find((l) => l.title === '自由泳入门')!
const swNodes = allNodes.filter((n) => n.lineId === sw.id)
const swTree = buildTree(swNodes)
check('自由泳线 13 个节点、根正确', swNodes.length === 13 && swTree.root?.name === '自由泳入门')
check('两条线节点无交叉引用', sdNodes.every((n) => n.lineId === sd.id) && swNodes.every((n) => n.lineId === sw.id))
check('自由泳线没有任何已点亮边', swNodes.every((n) => !n.edgeLit))
renderTree({
  svgEl,
  root: swTree.root!,
  childrenMap: swTree.childrenMap,
  collapsed: new Set(),
  selectedId: swTree.root!.id,
  transform: d3.zoomIdentity,
  fitRoot: true,
  onSelect: noop,
  onToggleCollapse: noop,
  onFocus: noop,
  onBackgroundClick: noop,
  onTransformChange: noop
})
check('自由泳树渲染 13 节点 12 边 0 标签', svgEl.querySelectorAll('g.node').length === 13 && svgEl.querySelectorAll('path.link').length === 12 && svgEl.querySelectorAll('text.edge-label').length === 0)

// ---- 7. 原理字段与深度模板 ----
const sdRoot = sdNodes.find((n) => n.parentId === null)!
check('短除法根节点带原理字段', (sdRoot.principle ?? '').length > 10, sdRoot.principle)
const specDepth = (s: any): number => 1 + Math.max(0, ...((s.children ?? []) as any[]).map((c) => specDepth(c)))
const tpl = demoTreeSpec('测试目标', '测试原因')
check('演示模板深度 ≥ 4 层', specDepth(tpl) >= 4, 'got ' + specDepth(tpl))
check('演示模板不含误区分支', !JSON.stringify(tpl).includes('误区'))
check('演示数据不含易错点', allNodes.every((n) => !n.pitfalls || n.pitfalls.length === 0))

// ---- 8. 继续分解（分支不设上限） ----
const kids = await aiDecomposeNode(td.root!, sd.title)
check('演示模式分解出 ≥2 个子节点且父节点正确', kids.length >= 2 && kids.every((k) => k.parentId === td.root!.id), 'got ' + kids.length)
check('分解出的子节点都带原理', kids.every((k) => (k.principle ?? '').length > 0))
await db.nodes.bulkAdd(kids)
const grown = buildTree(await db.nodes.where('lineId').equals(sd.id).toArray())
renderTree({
  svgEl,
  root: grown.root!,
  childrenMap: grown.childrenMap,
  collapsed: new Set(),
  selectedId: td.root!.id,
  transform: d3.zoomIdentity,
  fitRoot: true,
  onSelect: noop,
  onToggleCollapse: noop,
  onFocus: noop,
  onBackgroundClick: noop,
  onTransformChange: noop
})
check('继续分解后树上节点数增长为 ' + (16 + kids.length), svgEl.querySelectorAll('g.node').length === 16 + kids.length, 'got ' + svgEl.querySelectorAll('g.node').length)

// ---- 9. 误区节点清理迁移 ----
await db.nodes.add({
  id: uid(),
  lineId: sd.id,
  parentId: td.root!.id,
  name: '误区：测试节点',
  definition: 'x',
  example: 'x',
  whyImportant: 'x',
  state: 'unlearned',
  edgeWhy: null,
  edgeExamples: [],
  edgeLit: false,
  createdAt: Date.now(),
  updatedAt: Date.now()
})
const removed = await removeMistakeNodes()
check('removeMistakeNodes 清除误区节点', removed === 1, 'got ' + removed)
check('误区节点已从数据库消失', (await db.nodes.filter((n) => /误区/.test(n.name)).count()) === 0)

// ---- 汇总 ----
console.log('')
console.log('======== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ========')
if (fail > 0) process.exitCode = 1
}
main().catch((e) => {
  console.error('TEST CRASH:', e)
  process.exit(2)
})