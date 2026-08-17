// ---------- 端到端验证：用 fake-indexeddb + jsdom 跑真实生产代码 ----------
import './fake-idb-setup'
import { JSDOM } from 'jsdom'
import { writeFileSync } from 'node:fs'
import * as d3 from 'd3'
import { db, uid, exportAllDataObject, type SyncPayload } from '../src/db'
import { ensureDemoSeed, demoTreeSpec, removeMistakeNodes, demoWeeklyReview, demoHighDimInterpretation } from '../src/lib/demo'
import { buildTree, computeStats } from '../src/lib/treeUtils'
import { renderTree } from '../src/lib/renderTree'
import { aiLightEdge, aiDecomposeNode, aiAutoDecompose, aiGoalSpec, aiGenerateTree, moduleModel, nodeNameIsAtomic, nodeIsAtomic, aiBuildDiagnosticQuiz, aiEvaluateAnswer, aiFeynmanRetellFeedback, aiFeynmanTasks, aiFeynmanAnswerFeedback, aiWeeklyReview, aiHighDimInterpretation } from '../src/lib/ai'
import { feynmanRemainingSeconds, feynmanStageSeconds, feynmanNextStage, feynmanSessionInit, feynmanAvgScore, feynmanCompletionBoost } from '../src/lib/feynman'
import { buildDailyPlan, eligibleNodes, nodeMinutes } from '../src/lib/plan'
import { BADGES, computeStreak, evaluateBadges, dayKey, recordActivity } from '../src/lib/achievements'
import { computeWeekStats, weekStart, weekLabel } from '../src/lib/review'
import { mergeAllData, applySyncPayload } from '../src/lib/sync'
import type { TreeNode, NodeState } from '../src/types'

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
check('根节点带选中描边', (svgEl.querySelector('g.node rect')?.getAttribute('stroke-width') ?? '') === '2.5')
const toggles = svgEl.querySelectorAll('circle.collapse-toggle')
check('有子节点的节点带折叠按钮（6 个）', toggles.length === 6, 'got ' + toggles.length)
check('所有边路径非空', [...svgEl.querySelectorAll('path.link')].every((p) => (p.getAttribute('d') ?? '').length > 10))
check('连线为弧线（贝塞尔曲线）', [...svgEl.querySelectorAll('path.link')].every((p) => (p.getAttribute('d') ?? '').includes('C')))
check('所有连线为虚线', [...svgEl.querySelectorAll('path.link')].every((p) => (p.getAttribute('stroke-dasharray') ?? '') !== ''))
check('每个节点带掌握度进度条', svgEl.querySelectorAll('rect.mastery-bar').length === 16, 'got ' + svgEl.querySelectorAll('rect.mastery-bar').length)

// 分组布局：大类之间距离 > 同一大类内部同级距离
const getX = (el: Element): number => {
  const m = (el.getAttribute('transform') ?? '').match(/translate\(([-\d.]+),/)
  return m ? Number(m[1]) : 0
}
const topXs = [...svgEl.querySelectorAll('g.node[data-depth="1"]')].map(getX).sort((a, b) => a - b)
const innerXs = [...svgEl.querySelectorAll('g.node[data-depth="2"]')].map(getX).sort((a, b) => a - b)
const topGaps: number[] = []
const innerGaps: number[] = []
for (let i = 1; i < topXs.length; i++) topGaps.push(topXs[i] - topXs[i - 1])
for (let i = 1; i < innerXs.length; i++) innerGaps.push(innerXs[i] - innerXs[i - 1])
check(
  '大类之间间距 > 大类内部同级间距',
  Math.min(...topGaps) > Math.max(...innerGaps),
  JSON.stringify({ topGaps, innerGaps })
)

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
check('演示模板深度 ≥ 3 层（叶子即原子单元）', specDepth(tpl) >= 3, 'got ' + specDepth(tpl))
check('演示模板不含误区分支', !JSON.stringify(tpl).includes('误区'))
check('演示模板为能力句式（无课程目录标签）', !JSON.stringify(tpl).includes('基本概念') && !JSON.stringify(tpl).includes('标准流程'))
check('演示数据不含易错点', allNodes.every((n) => !n.pitfalls || n.pitfalls.length === 0))

// 原子性硬判定
check('名称含「与」判定为非原子', nodeNameIsAtomic('能实现 Q 与 K 投影') === false)
check('单一能力名称判定为原子', nodeNameIsAtomic('能实现 softmax') === true)

// ---- 8. 继续分解（分支不设上限） ----
const decomposeRes = await aiDecomposeNode(td.root!, sd.title)
const kids = decomposeRes.children
check('演示模式分解出 ≥2 个子节点且父节点正确', !decomposeRes.done && kids.length >= 2 && kids.every((k) => k.parentId === td.root!.id), 'got ' + kids.length)
check('分解出的子节点都带原理', kids.every((k) => (k.principle ?? '').length > 0))
check('分解出的子节点带原子字段（分钟/测试/实践）', kids.every((k) => (k.minutes ?? 0) <= 90 && !!k.test && !!k.practice))
await db.nodes.bulkAdd(kids)

// ---- 8.5 自动深度分解（frontier 队列 + 预算 + 报告） ----
const autoBefore = 3
const autoRes = await aiAutoDecompose(
  { id: sd.id, title: sd.title, reason: '', createdAt: Date.now(), status: 'active' },
  sdNodes.slice(0, autoBefore),
  { budget: 8, maxNodes: 50 }
)
check('自动深度分解会持续拆分叶子', autoRes.nodes.length > autoBefore, 'got ' + autoRes.nodes.length)
check('分解报告三态互斥且完整', [autoRes.report.frontierExhausted, autoRes.report.budgetExceeded, autoRes.report.maxNodesExceeded].filter(Boolean).length === 1, JSON.stringify(autoRes.report))
check('分解报告含失败计数', typeof autoRes.report.failures === 'number')

// ---- 8.6 Goal Specification + 原子判定 ----
const gs = await aiGoalSpec(sd)
check('目标规格书含交付物与成功标准', !!gs.goal && !!gs.deliverable && gs.criteria.length >= 3, JSON.stringify(gs))
const genResult = await aiGenerateTree(sd, { id: 's', lineId: sd.id, stage: 'done', messages: [], checklist: [], round: 3 })
check('演示模式生成结果带溯源（source=demo）', genResult.meta.source === 'demo' && genResult.meta.model === '内置模板', JSON.stringify(genResult.meta))

// ---- 8.8 各模块独立模型解析（证明「独立调用」真实生效） ----
const fakeSettings = {
  id: 'app',
  apiKey: 'sk-x',
  apiBase: 'https://api.deepseek.com',
  model: 'deepseek-v4-pro',
  depth: 'deep' as const,
  skeletonNoThinking: true,
  decomposeNoThinking: true,
  demoVersion: 0,
  models: { decompose: 'deepseek-v4-flash', skeleton: '' }
}
check('模块覆盖优先于全局默认', moduleModel(fakeSettings, 'decompose') === 'deepseek-v4-flash')
check('未单独设置的模块跟随全局默认', moduleModel(fakeSettings, 'chat') === 'deepseek-v4-pro')
check('空字符串覆盖回退到全局默认', moduleModel(fakeSettings, 'skeleton') === 'deepseek-v4-pro')
const dk = (await aiDecomposeNode(td.root!, sd.title)).children
check('演示分解出的叶子通过 nodeIsAtomic 硬判定', dk.every((k) => nodeIsAtomic(k)), 'first: ' + dk[0]?.name)

// ---- 8.7 证据式诊断（出题 + 评分） ----
const quizItems = await aiBuildDiagnosticQuiz(sd, dk.slice(0, 2))
check('诊断出题为每个目标生成题目', quizItems.length === 2 && quizItems.every((q) => !!q.question && !!q.rubric))
const evalRes = await aiEvaluateAnswer(sd, quizItems[0], '我会 softmax，它是把分数转成概率分布的函数，公式是 exp(x)/sum(exp(x))。')
check('AI 评分返回 0~100 分数与反馈', evalRes.score >= 0 && evalRes.score <= 100 && !!evalRes.feedback, JSON.stringify(evalRes))
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

// ---- 10. 费曼 3×30 ----

// 10.1 计时与阶段纯逻辑
const fsess = feynmanSessionInit(sd.id, td.root!.id)
check('费曼会话初始为理解阶段且每阶段 30 分钟', fsess.stage === 'understand' && feynmanStageSeconds() === 1800 && fsess.stageRemainingSeconds === 1800)
const now0 = Date.now()
check(
  '计时运行中剩余秒数按截止时间计算',
  feynmanRemainingSeconds({ ...fsess, stageEndsAt: now0 + 90_000 }, now0) === 90
)
check(
  '计时暂停时剩余秒数按暂存值计算',
  feynmanRemainingSeconds({ ...fsess, stageEndsAt: null, stageRemainingSeconds: 120 }, now0) === 120
)
check('阶段推进顺序正确', feynmanNextStage('understand') === 'retell' && feynmanNextStage('retell') === 'apply' && feynmanNextStage('apply') === null)

// 10.2 复述点评（演示模式规则）
const fbBad = await aiFeynmanRetellFeedback(td.root!, '我不会')
const fbGood = await aiFeynmanRetellFeedback(
  td.root!,
  '短除法是一种分解质因数的竖式计算方法：用质数不断去除一个数，直到商为质数，用它可快速求最大公因数和最小公倍数。比如 36 不断除以 2 和 3，得到 2×2×3×3。'
)
check('复述点评返回 0~100 分与缺口列表', fbBad.score >= 0 && fbBad.score <= 100 && fbBad.gaps.length >= 1 && fbGood.score >= 0 && fbGood.score <= 100)
check('讲得完整比没讲得分高', fbGood.score > fbBad.score, JSON.stringify({ bad: fbBad.score, good: fbGood.score }))
check('得分高时缺口更少或没有', fbGood.gaps.length <= fbBad.gaps.length)

// 10.3 应用出题与答题评分
const ftasks = await aiFeynmanTasks(td.root!)
check('应用出题 2~3 道且都有题干', ftasks.length >= 2 && ftasks.length <= 3 && ftasks.every((t) => (t.question ?? '').length > 0), 'got ' + ftasks.length)
const fAnsBad = await aiFeynmanAnswerFeedback(td.root!, ftasks[0], '不会')
const fAnsGood = await aiFeynmanAnswerFeedback(
  td.root!,
  ftasks[0],
  '我会先把被除数写成质因数连乘的形式，然后反复除以能整除的质数直到商为质数，这样就能快速求出最大公因数和最小公倍数，用纸笔一步步做下来。'
)
check('答题评分返回 0~100 分', fAnsBad.score >= 0 && fAnsBad.score <= 100 && fAnsGood.score >= 0 && fAnsGood.score <= 100)
check('认真作答比空答得分高', fAnsGood.score > fAnsBad.score, JSON.stringify({ bad: fAnsBad.score, good: fAnsGood.score }))

// 10.4 会话持久化与结算
await db.feynman.put(fsess)
const readBack = await db.feynman.get(fsess.id)
check('费曼会话写入数据库后可读回', readBack?.nodeId === td.root!.id && readBack?.stage === 'understand')
const scored = {
  ...fsess,
  retellFeedback: { score: 80, strengths: ['s'], gaps: [], suggestion: 'g' },
  answerFeedbacks: {
    a: { score: 60, strengths: ['s'], gaps: [], suggestion: 'g' },
    b: { score: 100, strengths: ['s'], gaps: [], suggestion: 'g' }
  }
}
check('会话平均分为各评分均值', feynmanAvgScore(scored) === 80, 'got ' + feynmanAvgScore(scored))
check('完成加成 10~20（平均分 80 → +18）', feynmanCompletionBoost(80) === 18 && feynmanCompletionBoost(100) === 20 && feynmanCompletionBoost(0) === 10)
await db.feynman.delete(fsess.id)
check('费曼会话删除后清理干净', (await db.feynman.count()) === 0)

// 10.5 费曼模块跟随模块模型解析
check('费曼模块未覆盖时跟随全局默认', moduleModel(fakeSettings, 'feynman') === 'deepseek-v4-pro')

// ---- 11. 今日学习计划（最少 / 极限） ----

const mkNode = (id: string, parentId: string | null, state: NodeState, minutes?: number): TreeNode => ({
  id,
  lineId: 'plan-test',
  parentId,
  name: id,
  definition: 'x',
  example: 'x',
  whyImportant: 'x',
  state,
  minutes,
  edgeWhy: null,
  edgeExamples: [],
  edgeLit: false,
  createdAt: 1,
  updatedAt: 1
})

const planNodes: TreeNode[] = [
  mkNode('root', null, 'mastered', 10),
  mkNode('a-fuzzy', 'root', 'fuzzy', 8),
  mkNode('b-learning', 'root', 'learning', 6),
  mkNode('c-unlearned', 'root', 'unlearned', 4),
  mkNode('d-mastered', 'root', 'mastered', 5),
  mkNode('e-under-unlearned-parent', 'c-unlearned', 'unlearned', 3),
  mkNode('f-no-minutes', 'root', 'unlearned')
]

const eligible = eligibleNodes(planNodes)
check(
  '计划只挑「前沿」节点（未掌握且父节点已掌握或无父节点）',
  eligible.length === 4 &&
    eligible.every((n) => n.id !== 'd-mastered' && n.id !== 'e-under-unlearned-parent'),
  JSON.stringify(eligible.map((n) => n.id))
)
check('缺失预计时长按 5 分钟计', nodeMinutes(mkNode('x', null, 'unlearned')) === 5 && nodeMinutes(mkNode('x', null, 'unlearned', 8)) === 8)

const planMin20 = buildDailyPlan(planNodes, 20, 'minimal')
check(
  '最少模式优先补薄弱环节（模糊 > 学习中 > 未学）',
  planMin20.items.length === 3 &&
    planMin20.items[0].node.id === 'a-fuzzy' &&
    planMin20.items[1].node.id === 'b-learning' &&
    planMin20.items[2].node.id === 'c-unlearned',
  JSON.stringify(planMin20.items.map((i) => i.node.id + ':' + i.minutes))
)
const planMin = buildDailyPlan(planNodes, 12, 'minimal')
const planExt = buildDailyPlan(planNodes, 12, 'extreme')
check('极限模式在同样预算内塞进最多节点', planExt.items.length >= planMin.items.length, 'extreme ' + planExt.items.length + ' vs minimal ' + planMin.items.length)
check(
  '极限模式按短节点优先（时长非递减）',
  planExt.items.every((it, i, arr) => i === 0 || arr[i - 1].minutes <= it.minutes),
  JSON.stringify(planExt.items.map((i) => i.minutes))
)
const planTiny = buildDailyPlan(planNodes, 1, 'minimal')
check('预算装不下任何节点时仍保留最高优先级一项并提示超支', planTiny.items.length === 1 && planTiny.leftoverMinutes < 0 && planTiny.note.includes('挑战'), JSON.stringify(planTiny))
const planDone = buildDailyPlan([mkNode('g', null, 'mastered', 5)], 30, 'minimal')
check('全部掌握时计划为空并给出完成提示', planDone.items.length === 0 && planDone.note.includes('全部掌握'), planDone.note)

// ---- 12. 娱乐激励正反馈闭环 ----

// 12.1 日期键与连续天数
check('日期键按本地时区生成', dayKey(new Date(2026, 0, 5, 12).getTime()) === '2026-01-05', dayKey(new Date(2026, 0, 5, 12).getTime()))
const sdk = (i: number) => dayKey(new Date(2026, 0, 15 - i, 12).getTime())
const todayKey = sdk(0)
check('无活动时连续天数为 0', computeStreak(new Set(), todayKey) === 0)
check('只有今天活动为 1 天', computeStreak(new Set([sdk(0)]), todayKey) === 1)
check('连续 3 天计数正确', computeStreak(new Set([sdk(0), sdk(1), sdk(2)]), todayKey) === 3)
check('中断后重新计数', computeStreak(new Set([sdk(0), sdk(2)]), todayKey) === 1)
check('今天没学但昨天学过不断签', computeStreak(new Set([sdk(1), sdk(2)]), todayKey) === 2)
check('两天没学归零', computeStreak(new Set([sdk(2)]), todayKey) === 0)

// 12.2 成就判定阈值与去重
const snap = (p: Partial<{ masteredCount: number; edgeLitCount: number; feynmanDoneCount: number; planExtremeCount: number; lineDoneCount: number; streak: number }> = {}) => ({
  masteredCount: 0,
  edgeLitCount: 0,
  feynmanDoneCount: 0,
  planExtremeCount: 0,
  lineDoneCount: 0,
  streak: 0,
  ...p
})
check('成就阈值判定正确', (
  evaluateBadges(snap({ masteredCount: 1 }), new Set()).join('|') === 'first-blood' &&
  evaluateBadges(snap({ masteredCount: 10 }), new Set()).includes('node-10') &&
  evaluateBadges(snap({ masteredCount: 30 }), new Set()).includes('node-30') &&
  evaluateBadges(snap({ edgeLitCount: 1 }), new Set()).join('|') === 'edge-first' &&
  evaluateBadges(snap({ feynmanDoneCount: 1 }), new Set()).join('|') === 'feynman-first' &&
  evaluateBadges(snap({ feynmanDoneCount: 5 }), new Set()).includes('feynman-5') &&
  evaluateBadges(snap({ streak: 3 }), new Set()).join('|') === 'streak-3' &&
  evaluateBadges(snap({ streak: 7 }), new Set()).includes('streak-7') &&
  evaluateBadges(snap({ planExtremeCount: 1 }), new Set()).join('|') === 'extreme-first' &&
  evaluateBadges(snap({ lineDoneCount: 1 }), new Set()).join('|') === 'line-done'
))
check('已解锁成就不会重复判定', evaluateBadges(snap({ masteredCount: 10 }), new Set(['first-blood', 'node-10'])).length === 0)

// 12.3 活动记录与解锁结算（真实数据库）
await db.activity.clear()
await db.badges.clear()
const u1 = await recordActivity('node-mastered', sd.id)
const u1Ids = u1.unlocks.map((b) => b.id).sort()
check(
  '首次记录活动解锁「初露锋芒」与「连点成线」',
  u1Ids.join('|') === 'edge-first|first-blood',
  u1Ids.join('|')
)
check('活动日志写入数据库', (await db.activity.count()) === 1)
for (let i = 0; i < 4; i++) await recordActivity('feynman-done', sd.id)
const u2 = await recordActivity('feynman-done', sd.id)
check('第 5 次费曼解锁「费曼信徒」', u2.unlocks.map((b) => b.id).includes('feynman-5'), u2.unlocks.map((b) => b.id).join(','))
const u3 = await recordActivity('plan-generated', sd.id, 'extreme')
check('极限计划解锁「极限玩家」', u3.unlocks.map((b) => b.id).includes('extreme-first'))
const u4 = await recordActivity('node-mastered', sd.id)
check('重复活动不再解锁新成就', u4.unlocks.length === 0)
check('共解锁 5 个成就', (await db.badges.count()) === 5, 'got ' + (await db.badges.count()))
check('成就定义完整（10 个）', BADGES.length === 10)

// ---- 13. 复述笔记本 + 每周复盘 ----

// 13.1 周界与周标签（2026-08-17 是周一）
const wedAug19 = new Date(2026, 7, 19, 15).getTime()
check('weekStart 回到本周一 00:00', weekStart(wedAug19) === new Date(2026, 7, 17).getTime(), new Date(weekStart(wedAug19)).toString())
check('周标签格式正确', weekLabel(wedAug19) === '2026-08-17 ~ 2026-08-23', weekLabel(wedAug19))

// 13.2 周统计聚合
const inWeek = weekStart(wedAug19)
const weekEvents = [
  { id: 'e1', kind: 'node-mastered' as const, at: inWeek + 1000 },
  { id: 'e2', kind: 'node-mastered' as const, at: inWeek + 2000 },
  { id: 'e3', kind: 'edge-lit' as const, at: inWeek + 3000 },
  { id: 'e4', kind: 'plan-generated' as const, detail: 'extreme', at: inWeek + 4000 },
  { id: 'e5', kind: 'feynman-done' as const, at: inWeek - 1000 } // 上周
]
const weekSessions = [
  { id: 's1', status: 'done' as const, avgScore: 80, updatedAt: inWeek + 5000 },
  { id: 's2', status: 'done' as const, avgScore: 60, updatedAt: inWeek + 6000 },
  { id: 's3', status: 'done' as const, avgScore: 99, updatedAt: inWeek - 2000 } // 上周
]
const ws = computeWeekStats(weekEvents, weekSessions as never[], 4, wedAug19)
check(
  '周统计聚合正确（本周事件 + 费曼均分 + 连续天数）',
  ws.nodeMastered === 2 && ws.edgeLit === 1 && ws.planGenerated === 1 && ws.feynmanDone === 0 && ws.avgFeynmanScore === 70 && ws.streak === 4,
  JSON.stringify(ws)
)
check('本周无费曼完成时均分为 0', computeWeekStats(weekEvents, [], 1, wedAug19).avgFeynmanScore === 0)

// 13.3 AI 周复盘（演示模式模板）
const reviewText = await aiWeeklyReview(ws)
check('周复盘生成可用文本（演示模式）', reviewText.length > 20 && reviewText.includes('本周'), reviewText.slice(0, 40))
check('演示周复盘包含关键数字', reviewText.includes('2 次'))
const wsWithFeynman = { ...ws, feynmanDone: 2 }
check('有费曼记录时复盘提到平均分', demoWeeklyReview(wsWithFeynman).includes('70 分'))
const demoTpl = demoWeeklyReview(ws)
check('演示模板与 AI 演示路径一致', demoTpl === reviewText)
check('复盘模块未覆盖时跟随全局默认', moduleModel(fakeSettings, 'review') === 'deepseek-v4-pro')

// ---- 14. 高维认知解读 ----

const hdText = await aiHighDimInterpretation(td.root!, ['除法基本概念', '分数约分'])
check('高维解读生成可用文本（演示模式）', hdText.length > 30 && hdText.includes('更高维度') && hdText.includes(td.root!.name), hdText.slice(0, 40))
check('高维解读会引用已掌握概念', hdText.includes('除法基本概念'))
check('演示模板与 AI 演示路径一致', demoHighDimInterpretation(td.root!, ['除法基本概念', '分数约分']) === hdText)
await db.nodes.update(td.root!.id, { highDim: { text: hdText, model: 'demo', masteredCount: 2, at: Date.now() } })
const hdNode = await db.nodes.get(td.root!.id)
check('高维解读持久化到节点', hdNode?.highDim?.text === hdText && hdNode.highDim.masteredCount === 2)
const tmpNode = await db.nodes.get(td.root!.id)
if (tmpNode) {
  delete (tmpNode as Partial<TreeNode>).highDim
  await db.nodes.put(tmpNode)
}
check('高维解读可清除', (await db.nodes.get(td.root!.id))?.highDim === undefined)
check('高维模块未覆盖时跟随全局默认', moduleModel(fakeSettings, 'highdim') === 'deepseek-v4-pro')

// ---- 15. 多设备同步（合并 + 应用；本段最后执行，会重放数据库） ----

const localPayload = await exportAllDataObject()
const firstNode = localPayload.nodes[0]
const remotePayload: SyncPayload = {
  version: 3,
  exportedAt: new Date().toISOString(),
  lines: localPayload.lines.slice(1), // 远程缺第一条线 → 合并后应保留
  nodes: [
    { ...firstNode, definition: 'remote-newer', updatedAt: firstNode.updatedAt + 10000 },
    { ...localPayload.nodes[1], id: 'remote-only-node', updatedAt: Date.now() + 99999 }
  ],
  profile: [],
  settings: [{ ...localPayload.settings[0], apiKey: 'sk-remote', model: 'deepseek-reasoner' }],
  onboarding: [],
  feynman: [],
  activity: [],
  badges: []
}
const merged = mergeAllData(localPayload, remotePayload)
check('合并后节点为并集（本地 + 远程独有）', merged.nodes.length === localPayload.nodes.length + 1, 'got ' + merged.nodes.length)
const mergedFirst = merged.nodes.find((n) => n.id === firstNode.id)
check('同 id 冲突时时间戳新者胜', mergedFirst?.definition === 'remote-newer', mergedFirst?.definition)
check('远程缺失的本地学习线被保留', merged.lines.length === localPayload.lines.length, 'got ' + merged.lines.length)
const mergedSettings = merged.settings.find((s) => s.id === 'app')
check('settings 字段级合并（本地空字段用远程补）', mergedSettings?.apiKey === 'sk-remote', mergedSettings?.apiKey)
check('settings 本地非空字段不被远程覆盖', mergedSettings?.model === localPayload.settings[0].model)
const mergedNoRemote = mergeAllData(localPayload, null)
check('远程无文件时合并结果等于本地', mergedNoRemote.nodes.length === localPayload.nodes.length)
await applySyncPayload(merged)
check('合并结果应用到数据库（节点数一致）', (await db.nodes.count()) === merged.nodes.length)
check('应用后设置生效（API Key 已带过来）', (await db.settings.get('app'))?.apiKey === 'sk-remote')
check('本地独有学习线仍在', (await db.lines.count()) === merged.lines.length)

// ---- 汇总 ----
console.log('')
console.log('======== 结果：' + pass + ' 通过 / ' + fail + ' 失败 ========')
if (fail > 0) process.exitCode = 1
}
main().catch((e) => {
  console.error('TEST CRASH:', e)
  process.exit(2)
})