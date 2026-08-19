// ---------- 学习教练 Agent 的工具集 ----------
// 全部工具只操作本机 IndexedDB(学习线 / 知识树 / 档案 / 计划 / 复盘),
// 不访问外部网络;make_quiz 内部会调用一次 AI 生成题目(演示模式走模板)。
// 工具返回给模型的都是纯文本,模型基于这些真实数据组织回答。

import { db, uid } from '../../db'
import { buildDailyPlan, eligibleNodes, nodeMinutes, type PlanMode } from '../plan'
import { computeStats } from '../treeUtils'
import { computeStreak, dayKey, getUnlockedBadges, recordActivity } from '../achievements'
import { computeWeekStats } from '../review'
import { aiBuildDiagnosticQuiz } from '../ai'
import { STATE_LABEL, STATE_MASTERY, type LearningLine, type TreeNode, type NodeState } from '../../types'
import type { AgentTool } from './types'

// ---------- 内部辅助 ----------

const NODE_STATES: NodeState[] = ['fuzzy', 'learning', 'unlearned', 'mastered']

/** 按 id / 标题(含子串)定位学习线;不传时默认「进行中」的线,再退化为第一条 */
async function resolveLine(ref?: string): Promise<LearningLine | null> {
  const lines = await db.lines.toArray()
  if (lines.length === 0) return null
  if (!ref) {
    return lines.find((l) => l.status === 'active') ?? lines[0]
  }
  return lines.find((l) => l.id === ref || l.title === ref || l.title.includes(ref)) ?? null
}

async function lineNodes(lineId: string): Promise<TreeNode[]> {
  return db.nodes.where('lineId').equals(lineId).toArray()
}

/** 按 id / 名称(含子串)定位概念;不传 lineId 时在所有学习线里找 */
async function resolveNode(lineId: string | undefined, nameOrId: string): Promise<{ node: TreeNode; line: LearningLine } | null> {
  const lines = await db.lines.toArray()
  const scope = lineId ? lines.filter((l) => l.id === lineId) : lines
  for (const line of scope) {
    const nodes = await lineNodes(line.id)
    const hit = nodes.find((n) => n.id === nameOrId) ?? nodes.find((n) => n.name === nameOrId) ?? nodes.find((n) => n.name.includes(nameOrId))
    if (hit) return { node: hit, line }
  }
  return null
}

async function listLinesText(): Promise<string> {
  const lines = await db.lines.toArray()
  if (lines.length === 0) return '还没有任何学习线。'
  const parts: string[] = []
  for (const l of lines) {
    const nodes = await lineNodes(l.id)
    const s = computeStats(nodes)
    const cat = l.category === 'hobby' ? '兴趣爱好线' : l.category === 'career' ? '专业所需技术栈线' : '六个月专家线'
    parts.push(
      `- [id=${l.id}] ${l.title}（${cat}，${l.status === 'active' ? '进行中' : '已完成'}）：共 ${s.total} 个概念，🟢已掌握 ${s.mastered}，🟠学习中 ${s.learning}，🟡模糊 ${s.fuzzy}，⚪未学 ${s.unlearned}，完成度 ${s.pct}%`
    )
  }
  return parts.join('\n')
}

// ---------- 工具定义 ----------

const toolListLines: AgentTool = {
  name: 'list_learning_lines',
  description: '列出全部学习线及其概念状态统计(总数/已掌握/学习中/模糊/未学/完成度)。回答「有哪些学习线」「整体进度」类问题前必须先调用。',
  parameters: { type: 'object', properties: {} },
  execute: async () => listLinesText()
}

const toolTreeStatus: AgentTool = {
  name: 'get_tree_status',
  description:
    '查询某条学习线知识树的详细状态:各状态统计、薄弱概念清单(模糊/学习中,含 id 与预计时长)、学习前沿(下一步可学的概念,含 id)、已掌握清单。参数 lineId 可传学习线 id 或标题(可只传部分标题),不传则默认「进行中」的线。',
  parameters: {
    type: 'object',
    properties: {
      lineId: { type: 'string', description: '学习线 id 或标题(可只传部分标题);不传则用默认学习线' }
    }
  },
  execute: async (args) => {
    const line = await resolveLine(typeof args.lineId === 'string' ? args.lineId : undefined)
    if (!line) return '没有找到学习线。请先调用 list_learning_lines 查看有哪些学习线。'
    const nodes = await lineNodes(line.id)
    const s = computeStats(nodes)
    const weak = nodes.filter((n) => n.state === 'fuzzy' || n.state === 'learning').sort((a, b) => (a.state === 'fuzzy' ? -1 : 1))
    const frontier = eligibleNodes(nodes).sort((a, b) => nodeMinutes(a) - nodeMinutes(b))
    const mastered = nodes.filter((n) => n.state === 'mastered').map((n) => n.name)
    const out = [
      `学习线「${line.title}」[id=${line.id}]`,
      `状态统计:共 ${s.total} 个概念 —— 🟢已掌握 ${s.mastered}，🟠学习中 ${s.learning}，🟡模糊 ${s.fuzzy}，⚪未学 ${s.unlearned}（完成度 ${s.pct}%）`,
      '',
      `薄弱概念（优先补）:${weak.length === 0 ? ' 无 🎉' : ''}`
    ]
    weak.forEach((n) => out.push(`- [id=${n.id}] ${n.name}（${STATE_LABEL[n.state]}，约 ${nodeMinutes(n)} 分钟）`))
    out.push('', `学习前沿（下一步可学,父概念已掌握）:${frontier.length === 0 ? ' 无 —— 概念已全部掌握或都还学不了' : ''}`)
    frontier.forEach((n) => out.push(`- [id=${n.id}] ${n.name}（${STATE_LABEL[n.state]}，约 ${nodeMinutes(n)} 分钟）`))
    out.push('', `已掌握:${mastered.length === 0 ? ' 无' : ' ' + mastered.slice(0, 20).join('、') + (mastered.length > 20 ? ' 等 ' + mastered.length + ' 个' : '')}`)
    return out.join('\n')
  }
}

const toolNodeDetail: AgentTool = {
  name: 'get_node_detail',
  description:
    '查询一个概念的完整信息:名称、状态与掌握度、定义、通俗原理、例子、为什么重要、易错点、掌握标准、最小实践、父/子概念、高维解读。参数 name 传概念名称(可只传部分)或 id;lineId 可选,用于限定学习线。',
  parameters: {
    type: 'object',
    properties: {
      lineId: { type: 'string', description: '可选,学习线 id;不传则在全部学习线里找' },
      name: { type: 'string', description: '概念名称(可只传部分)或节点 id' }
    },
    required: ['name']
  },
  execute: async (args) => {
    const name = String(args.name ?? '').trim()
    if (!name) return '参数 name 不能为空。'
    const hit = await resolveNode(typeof args.lineId === 'string' ? args.lineId : undefined, name)
    if (!hit) return '没有找到叫「' + name + '」的概念。可以先用 get_tree_status 查看概念清单。'
    const { node, line } = hit
    const all = await lineNodes(line.id)
    const kids = all.filter((n) => n.parentId === node.id).map((n) => n.name)
    const parent = node.parentId ? all.find((n) => n.id === node.parentId) : undefined
    const rows: string[] = [
      `概念「${node.name}」[id=${node.id}]（学习线:${line.title}）`,
      `状态:${STATE_LABEL[node.state]}（掌握度 ${node.mastery ?? STATE_MASTERY[node.state]}%）`,
      `定义:${node.definition || '（未提供）'}`
    ]
    if (node.principle) rows.push(`通俗原理:${node.principle}`)
    if (node.example) rows.push(`例子:${node.example}`)
    if (node.whyImportant) rows.push(`为什么重要:${node.whyImportant}`)
    if (node.pitfalls?.length) rows.push('易错点:' + node.pitfalls.map((p) => '• ' + p).join(''))
    if (node.test) rows.push(`掌握标准:${node.test}`)
    if (node.practice) rows.push(`最小实践:${node.practice}`)
    if (node.minutes) rows.push(`预计学习时长:${node.minutes} 分钟`)
    if (parent) rows.push(`父概念:${parent.name}`)
    rows.push(`子概念:${kids.length === 0 ? '（无,已是叶子）' : kids.join('、')}`)
    if (node.highDim) rows.push(`高维解读:${node.highDim.text}`)
    return rows.join('\n')
  }
}

const toolProfile: AgentTool = {
  name: 'get_knowledge_profile',
  description: '读取用户的动态知识档案(「我会什么」页):已掌握知识条目与备注、来源。回答「我会什么」「掌握哪些」类问题前先调用。',
  parameters: { type: 'object', properties: {} },
  execute: async () => {
    const entries = await db.profile.toArray()
    if (entries.length === 0) return '知识档案还是空的。可以建议用户用 add_profile_entry 添加,或先学一些概念让档案自动生长。'
    return entries
      .map((e, i) => `${i + 1}. ${e.name}${e.note ? ': ' + e.note : ''}（来源:${e.source === 'manual' ? '手动添加' : e.source === 'coach' ? '学习教练' : '学习线'}）`)
      .join('\n')
  }
}

const toolStats: AgentTool = {
  name: 'get_learning_stats',
  description: '汇总学习数据:连续学习天数、本周统计(掌握/点亮/费曼/计划/费曼均分)、已解锁成就、学习线数量。回答「学得怎么样」「本周复盘」「成就」「连续天数」类问题前先调用。',
  parameters: { type: 'object', properties: {} },
  execute: async () => {
    const [activity, sessions, nodes, lines, unlocked] = await Promise.all([
      db.activity.toArray(),
      db.feynman.toArray(),
      db.nodes.toArray(),
      db.lines.toArray(),
      getUnlockedBadges()
    ])
    const streak = computeStreak(new Set(activity.map((a) => dayKey(a.at))), dayKey(Date.now()))
    const week = computeWeekStats(activity, sessions, streak, Date.now())
    const masteredTotal = nodes.filter((n) => n.state === 'mastered').length
    const activeLines = lines.filter((l) => l.status === 'active').length
    const out = [
      `🔥 连续学习 ${streak} 天`,
      `本周(周一起):掌握概念 ${week.nodeMastered} 个,点亮关联 ${week.edgeLit} 条,完成费曼 ${week.feynmanDone} 次,生成计划 ${week.planGenerated} 次${week.avgFeynmanScore > 0 ? ',费曼平均分 ' + week.avgFeynmanScore : ''}`,
      `累计:已掌握概念 ${masteredTotal} 个,进行中学习线 ${activeLines} 条`,
      `已解锁成就 ${unlocked.length}/10:${unlocked.length === 0 ? ' 还没有' : ' ' + unlocked.map((u) => u.badge.emoji + u.badge.name).join('、')}`
    ]
    return out.join('\n')
  }
}

const toolReviewHistory: AgentTool = {
  name: 'get_review_history',
  description: '读取最近完成的费曼学习会话(复述点评分与缺口)。回答「复盘」「哪里没讲清楚」「费曼记录」类问题前先调用。',
  parameters: {
    type: 'object',
    properties: {
      lineId: { type: 'string', description: '可选,学习线 id;不传则查全部学习线' }
    }
  },
  execute: async (args) => {
    const lineId = typeof args.lineId === 'string' ? args.lineId : undefined
    let sessions = (await db.feynman.toArray()).filter((s) => s.status === 'done' && s.avgScore > 0)
    const nodes = await db.nodes.toArray()
    const lines = await db.lines.toArray()
    if (lineId) sessions = sessions.filter((s) => s.lineId === lineId)
    sessions.sort((a, b) => b.updatedAt - a.updatedAt)
    if (sessions.length === 0) return '还没有完成过费曼学习会话。'
    const top = sessions.slice(0, 10)
    return top
      .map((s, i) => {
        const node = nodes.find((n) => n.id === s.nodeId)
        const line = lines.find((l) => l.id === s.lineId)
        const date = new Date(s.updatedAt)
        const gaps = s.retellFeedback?.gaps?.length ? '缺口:' + s.retellFeedback.gaps.join(';') : ''
        return `${i + 1}. [${date.getMonth() + 1}/${date.getDate()}] 「${node?.name ?? '(已删除概念)'}」（${line?.title ?? ''}）复述得分 ${s.avgScore}${gaps ? '。' + gaps : ''}`
      })
      .join('\n')
  }
}

const toolTodayPlan: AgentTool = {
  name: 'get_today_plan',
  description:
    '为某条学习线生成今日学习计划:budgetMinutes 是可用分钟数(默认 30),mode 是 minimal(保底:优先补模糊/学习中)或 extreme(极限:塞进最多概念,默认 minimal)。计划保证沿着学习前沿推进、不跳过前置概念。',
  parameters: {
    type: 'object',
    properties: {
      lineId: { type: 'string', description: '可选,学习线 id 或标题;不传则用默认学习线' },
      budgetMinutes: { type: 'number', description: '可选,今天可用分钟数,默认 30' },
      mode: { type: 'string', enum: ['minimal', 'extreme'], description: '可选,minimal=保底模式(默认),extreme=极限挑战' }
    }
  },
  execute: async (args) => {
    const line = await resolveLine(typeof args.lineId === 'string' ? args.lineId : undefined)
    if (!line) return '没有找到学习线。请先调用 list_learning_lines 查看有哪些学习线。'
    const budget = Math.max(5, Math.round(Number(args.budgetMinutes) || 30))
    const mode: PlanMode = args.mode === 'extreme' ? 'extreme' : 'minimal'
    const plan = buildDailyPlan(await lineNodes(line.id), budget, mode)
    const out = [
      `「${line.title}」今日计划（${mode === 'extreme' ? '极限挑战' : '最少保底'}模式,预算 ${plan.budgetMinutes} 分钟,共 ${plan.totalMinutes} 分钟）`,
      plan.items.length === 0 ? plan.note : plan.items.map((it) => `- ${it.node.name}（约 ${it.minutes} 分钟）:${it.reason}`).join('\n'),
      plan.items.length > 0 ? plan.note : ''
    ]
    return out.join('\n')
  }
}

const toolSetNodeState: AgentTool = {
  name: 'set_node_state',
  description:
    '把某个概念标记为指定状态:mastered(已掌握)/learning(学习中)/fuzzy(模糊)/unlearned(未学),掌握度会按状态自动更新;标记为 mastered 时计入学习打卡。只在用户明确要求改状态时调用。参数 name 传概念名称(可只传部分)或 id。',
  parameters: {
    type: 'object',
    properties: {
      lineId: { type: 'string', description: '可选,学习线 id,用于限定范围' },
      name: { type: 'string', description: '概念名称(可只传部分)或节点 id' },
      state: { type: 'string', enum: NODE_STATES, description: '目标状态' }
    },
    required: ['name', 'state']
  },
  execute: async (args) => {
    const state = String(args.state ?? '') as NodeState
    if (!NODE_STATES.includes(state)) return '无效状态:只能传 mastered / learning / fuzzy / unlearned。'
    const hit = await resolveNode(typeof args.lineId === 'string' ? args.lineId : undefined, String(args.name ?? '').trim())
    if (!hit) return '没有找到该概念。可以先用 get_tree_status 查看概念清单。'
    await db.nodes.update(hit.node.id, { state, mastery: STATE_MASTERY[state], updatedAt: Date.now() })
    let extra = ''
    if (state === 'mastered') {
      const { unlocks } = await recordActivity('node-mastered', hit.line.id)
      if (unlocks.length > 0) extra = ' 🎉 解锁成就:' + unlocks.map((u) => u.emoji + u.name).join('、')
    }
    return `✅ 已把「${hit.node.name}」标记为「${STATE_LABEL[state]}」（掌握度 ${STATE_MASTERY[state]}%）。${extra}`
  }
}

const toolAddProfile: AgentTool = {
  name: 'add_profile_entry',
  description: '往用户的动态知识档案(「我会什么」页)添加一条知识记录。只在用户明确要求记录时调用。',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: '知识名称' },
      note: { type: 'string', description: '可选,备注(一句话掌握情况)' }
    },
    required: ['name']
  },
  execute: async (args) => {
    const name = String(args.name ?? '').trim()
    if (!name) return '参数 name 不能为空。'
    await db.profile.add({ id: uid(), name, note: String(args.note ?? '').trim(), source: 'coach', addedAt: Date.now() })
    return `✅ 已把「${name}」加入知识档案(来源:学习教练)。`
  }
}

const toolMakeQuiz: AgentTool = {
  name: 'make_quiz',
  description:
    '基于学习线上真实存在的概念生成诊断测验(每题带评分要点)。默认从「学习前沿」挑 count 道(默认 3,最多 8);focus=weak 时优先挑薄弱概念。出题时先了解概念内容再调用本工具。',
  parameters: {
    type: 'object',
    properties: {
      lineId: { type: 'string', description: '可选,学习线 id 或标题;不传则用默认学习线' },
      count: { type: 'number', description: '可选,题目数量,默认 3,范围 1~8' },
      focus: { type: 'string', enum: ['weak', 'frontier'], description: '可选,weak=优先薄弱概念,frontier=学习前沿(默认)' }
    }
  },
  execute: async (args) => {
    const line = await resolveLine(typeof args.lineId === 'string' ? args.lineId : undefined)
    if (!line) return '没有找到学习线。请先调用 list_learning_lines 查看有哪些学习线。'
    const count = Math.min(8, Math.max(1, Math.round(Number(args.count) || 3)))
    const nodes = await lineNodes(line.id)
    let pool = eligibleNodes(nodes)
    if (args.focus === 'weak') pool = pool.sort((a, b) => (a.state === 'fuzzy' ? -1 : 1))
    if (pool.length === 0) pool = nodes.filter((n) => n.state !== 'mastered')
    if (pool.length === 0) return '这条学习线的概念已全部掌握,没有可出的题目 🎉'
    const targets = pool.slice(0, count)
    const items = await aiBuildDiagnosticQuiz(line, targets)
    const out = [`「${line.title}」诊断测验(${items.length} 题):`]
    items.forEach((q, i) => out.push(`${i + 1}. ${q.question}\n   评分要点:${q.rubric || '能说清定义并举例'}`))
    out.push('', '（出题范围:' + targets.map((t) => t.name).join('、') + '）')
    return out.join('\n')
  }
}

/** 全部教练工具（顺序即 system prompt 里的展示顺序） */
export const COACH_TOOLS: AgentTool[] = [
  toolListLines,
  toolTreeStatus,
  toolNodeDetail,
  toolProfile,
  toolStats,
  toolReviewHistory,
  toolTodayPlan,
  toolMakeQuiz,
  toolSetNodeState,
  toolAddProfile
]

/** 按名字执行工具（agent 循环与演示模式共用）；未知工具抛错 */
export async function executeCoachTool(name: string, args: Record<string, unknown>): Promise<string> {
  const tool = COACH_TOOLS.find((t) => t.name === name)
  if (!tool) throw new Error('未知工具:' + name)
  return tool.execute(args)
}
