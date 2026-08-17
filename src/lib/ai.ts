// ---------- AI 编排：有 API Key 走 DeepSeek，没有则走演示模板 ----------

import { getSettings, uid } from '../db'
import type { LearningLine, TreeNode, OnboardingSession, ChecklistItem, DecomposeDepth, LineCategory, AiModule, Settings, GoalSpec, GenerationMeta, FeynmanFeedback, FeynmanTask } from '../types'
import { deepseekChat, extractJson } from './deepseek'
import { demoChatQuestion, demoChecklist, demoTreeSpec, demoLightEdge, demoDecompose, demoSpecForTitle, demoFeynmanRetellFeedback, demoFeynmanTasks, demoFeynmanAnswerFeedback, demoWeeklyReview, demoHighDimInterpretation, type DemoNodeSpec } from './demo'
import type { WeekStats } from './review'

export function isDemoMode(settings: { apiKey: string }): boolean {
  return !settings.apiKey
}

/** 解析某个模块实际生效的模型：模块覆盖 > 全局默认（导出供测试验证） */
export function moduleModel(settings: Settings, module: AiModule): string {
  return (settings.models?.[module] ?? '').trim() || settings.model || 'deepseek-chat'
}

// ---- 0. Goal Specification：把模糊目标收敛成可检验的终局能力定义 ----

const GOAL_SPEC_SYSTEM = [
  '你是学习目标澄清教练。用户的原始目标可能很模糊（如「大模型构建」），你需要把它收敛成一个可执行、可检验的能力目标。',
  '输出 JSON：{"goal": "终局能力目标（一句话，能+动词+宾语）", "deliverable": "可检验的交付物", "criteria": ["成功标准1", "成功标准2", "成功标准3"], "options": ["方向A：…", "方向B：…"]}',
  '要求：',
  '1. deliverable 必须具体、可检验（一个真实可交付的东西，如「一个能训练并自回归生成的小 GPT」）；',
  '2. criteria 3~5 条，每条都能明确判定达成与否；',
  '3. 如果原始目标明显有多个互斥方向（如「大模型构建」可能是从零实现 Transformer / 完整预训练 / SFT与RL后训练 / 工业 LLM 工程化），不要替用户决定：在 options 里列出 3~5 个候选方向（每个一句话描述），同时 goal/deliverable/criteria 先按第一个方向给出；目标没有歧义时不要输出 options；',
  '4. 用通俗中文；只输出 JSON。'
].join('\n')

export interface GoalSpecResult extends GoalSpec {
  /** 目标有歧义时的候选方向（用户选择后再生成最终规格书） */
  options?: string[]
}

export async function aiGoalSpec(line: LearningLine, chosenScope?: string): Promise<GoalSpecResult> {
  const settings = await getSettings()
  if (isDemoMode(settings)) {
    return {
      goal: line.title,
      deliverable: '一件用「' + line.title + '」完成的真实小成果（演示模式默认范围）',
      criteria: ['能向别人讲清楚「' + line.title + '」是什么', '能独立完成一个最小实践', '能判断做得对不对']
    }
  }
  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: GOAL_SPEC_SYSTEM },
      {
        role: 'user',
        content:
          '用户的原始学习目标：' +
          line.title +
          '\n学习动机：' +
          (line.reason || '未说明') +
          (chosenScope ? '\n用户已明确选定方向：' + chosenScope + '。请严格按此方向生成规格书，不要输出 options。' : '\n请给出目标规格书。')
      }
    ],
    { json: true, temperature: 0.5, model: moduleModel(settings, 'skeleton') }
  )
  try {
    const data = extractJson<GoalSpecResult>(answer)
    if (data.goal && data.deliverable && Array.isArray(data.criteria) && data.criteria.length > 0) {
      return {
        goal: data.goal.trim(),
        deliverable: data.deliverable.trim(),
        criteria: data.criteria.slice(0, 6).map((c) => c.trim()),
        options: Array.isArray(data.options) ? data.options.slice(0, 5).map((o) => o.trim()) : undefined
      }
    }
    throw new Error('目标规格书缺少关键字段（goal/deliverable/criteria）')
  } catch (e) {
    console.error('目标规格解析失败', e)
    throw new Error('目标规格书生成失败：AI 返回无法解析的内容（' + (e as Error).message + '）')
  }
}

// ---- 1. 摸底聊天：AI 提出下一轮问题 ----

const CHAT_SYSTEM = [
  '你是友好耐心的学习摸底教练。你正在了解用户的学习基础，为定制学习路线做准备。',
  '你会收到一份「目标规格书」（终局能力/交付物/成功标准）。你的提问必须围绕达成该目标所需的具体前置能力展开（例如目标是实现 Transformer，就问矩阵运算、张量 shape、PyTorch Module、next-token label 构造等），不要问宽泛的使用经历。',
  '规则：',
  '1. 每次只问一个问题，具体、口语化、好回答；',
  '2. 根据用户前面的回答调整追问方向，重点挖掘他「已经会什么」和「还差什么」；',
  '3. 总共进行 3 轮提问，这是第 {round} 轮；',
  '4. 不要客套，直接问问题，50 字以内。'
].join('\n')

export async function aiChatQuestion(line: LearningLine, session: OnboardingSession): Promise<string> {
  const settings = await getSettings()
  if (isDemoMode(settings)) return demoChatQuestion(line.title, session.round)

  const history = session.messages
    .slice(-6)
    .map((m) => ({ role: (m.role === 'ai' ? 'assistant' : 'user') as 'assistant' | 'user', content: m.text }))
  const goalCtx = session.goalSpec
    ? '\n目标规格书：\n- 终局能力：' + session.goalSpec.goal + '\n- 交付物：' + session.goalSpec.deliverable + '\n- 成功标准：' + session.goalSpec.criteria.join('；')
    : ''
  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: CHAT_SYSTEM.replace('{round}', String(session.round + 1)) },
      {
        role: 'user',
        content: '用户想学：' + line.title + '（动机：' + (line.reason || '未说明') + '）。' + goalCtx + '\n' + (history.length ? '之前的对话：' : '')
      },
      ...history,
      { role: 'user', content: '请提出下一个摸底问题。' }
    ],
    { temperature: 0.8, model: moduleModel(settings, 'chat') }
  )
  return answer.trim() || demoChatQuestion(line.title, session.round)
}

// ---- 2. 自评清单 ----

const CHECKLIST_SYSTEM = [
  '你是学习摸底助手。根据用户的学习目标和摸底对话，生成 8~12 个前置知识点自评项，从基础到进阶排列。',
  '输出 JSON：{"items": [{"name": "知识点名称"}]}',
  '要求：name 是具体的知识点/技能（如「两位数除法竖式」），不是疑问句；覆盖该目标的主要前置链条；只输出 JSON。'
].join('\n')

export async function aiBuildChecklist(line: LearningLine, session: OnboardingSession): Promise<ChecklistItem[]> {
  const settings = await getSettings()
  if (isDemoMode(settings)) return demoChecklist(line.title)

  const history = session.messages
    .map((m) => (m.role === 'ai' ? '教练' : '学员') + '：' + m.text)
    .join('\n')
  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: CHECKLIST_SYSTEM },
      {
        role: 'user',
        content: '学习目标：' + line.title + '\n学习动机：' + (line.reason || '未说明') + '\n摸底对话：\n' + history + '\n请生成前置知识点自评清单。'
      }
    ],
    { json: true, temperature: 0.4, model: moduleModel(settings, 'checklist') }
  )
  try {
    const data = extractJson<{ items: { name: string }[] }>(answer)
    const items = data.items.slice(0, 15).map((it) => ({ id: uid(), name: it.name.trim(), state: 'unknown' as const }))
    if (items.length > 0) return items
  } catch (e) {
    console.warn('解析清单失败，回退演示清单', e)
  }
  return demoChecklist(line.title)
}

// ---- 2.5 诊断清单（在能力图谱生成之后，从图谱节点中挑选关键前置能力） ----

const DIAG_SYSTEM = [
  '你是学习诊断教练。下面给出一棵能力图谱的节点列表（每行一个能力）。',
  '请挑出 8~12 个「关键前置能力」节点，原样做成自评清单（用户勾选：会 / 模糊 / 不会）。',
  '输出 JSON：{"items": [{"name": "节点原文"}]}',
  '规则：',
  '1. name 必须原样使用节点原文（「能…」句式），不要改写；',
  '2. 优先挑前置性最强、最基础的能力，覆盖图谱的主要分支；',
  '3. 只输出 JSON。'
].join('\n')

export async function aiBuildChecklistFromTree(
  line: LearningLine,
  session: OnboardingSession,
  nodes: TreeNode[]
): Promise<ChecklistItem[]> {
  const settings = await getSettings()
  if (isDemoMode(settings)) return demoChecklist(line.title)
  const listed = nodes
    .slice(0, 80)
    .map((n) => '· ' + n.name)
    .join('\n')
  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: DIAG_SYSTEM },
      {
        role: 'user',
        content: '学习目标：' + line.title + '\n能力图谱节点：\n' + listed + '\n请生成自评清单。'
      }
    ],
    { json: true, temperature: 0.4, model: moduleModel(settings, 'checklist') }
  )
  try {
    const data = extractJson<{ items: { name: string }[] }>(answer)
    const items = data.items
      .slice(0, 15)
      .map((it) => ({ id: uid(), name: it.name.trim(), state: 'unknown' as const }))
    if (items.length > 0) return items
    throw new Error('诊断清单为空')
  } catch (e) {
    console.error('解析诊断清单失败', e)
    throw new Error('诊断清单生成失败：AI 返回无法解析的内容（' + (e as Error).message + '）')
  }
}

// ---- 3. 生成知识树骨架（分支不设上限，越详细越好） ----

function treeSystemPrompt(depth: DecomposeDepth): string {
  const rules =
    depth === 'deep'
      ? '1. 这一阶段只生成 2~3 层的能力骨架：root + 3~7 个一级能力 + 每个一级能力下 2~4 个子能力，总节点 10~25 个；不要一次性拆到底，深层细节会在后续阶段自动分解完成。'
      : '1. 树深 3~5 层，每层 3~7 个分支，总节点数 15~40。'
  return [
    '你是一位学习能力建模教练（Capability Modeling），不是课程大纲生成器。你要把用户的学习目标拆成「能力图谱」：每个节点都是一项可验证的能力，而不是知识主题。',
    '命名铁律：节点名必须写成「能 + 动词 + 宾语」的能力句式，例如「能实现 causal self-attention」「能解释梯度下降」；严禁使用「基本概念」「核心方法」「标准流程」「组成部分」「实际应用」这类抽象分类标签。',
    'root 是目标的终局能力定义：definition = 交付物（deliverable），example = 成功标准，principle = 为什么这样定义这个目标。',
    '输出必须是 JSON，格式：',
    '{',
    '  "root": { "name": "学习目标", "definition": "交付物", "example": "成功标准", "whyImportant": "...", "principle": "..." },',
    '  "nodes": [',
    '    { "name": "能…", "definition": "通俗定义", "example": "具体例子", "whyImportant": "为什么重要", "principle": "通俗原理", "parentPath": ["从根到父节点的概念名数组"], "mastered": false, "fuzzy": false }',
    '  ]',
    '}',
    '硬性要求：',
    rules,
    '2. 节点命名单一：每个节点只表达一项能力，名称里禁止出现「与 / 和 / 及 / 、」等连接词。',
    '3. principle 用一句最通俗的话解释这项能力为什么成立/为什么这样设计；不要输出易错点、误区等负面内容。',
    '4. 用户已掌握的能力仍保留在树上，标记 mastered=true；用户模糊的标记 fuzzy=true。',
    '5. 用通俗中文，面向该领域新手；definition 1~2 句，example 必须具体（带数字或场景）。',
    '6. 只输出 JSON，不要输出任何解释。'
  ].join('\n')
}
interface GenNode {
  name: string
  definition: string
  example: string
  whyImportant: string
  principle?: string
  pitfalls?: string[]
  minutes?: number
  test?: string
  practice?: string
  parentPath: string[]
  mastered?: boolean
  fuzzy?: boolean
}

export interface GenerateTreeResult {
  nodes: TreeNode[]
  /** 需要提示用户的信息（演示模式说明等） */
  note?: string
  /** 生成溯源：这棵树由谁、如何生成 */
  meta: GenerationMeta
}

/** 骨架结构校验：缺关键字段直接判失败（P0：宁可报错，不给假树） */
function validateSkeleton(data: { root: GenNode; nodes: GenNode[] }): void {
  if (!data.root || typeof data.root !== 'object' || !data.root.name || !data.root.definition) {
    throw new Error('骨架缺少 root 节点（name/definition 缺失）')
  }
  if (!Array.isArray(data.nodes) || data.nodes.length === 0) {
    throw new Error('骨架缺少 nodes 数组（没有任何子能力）')
  }
  for (const n of data.nodes.slice(0, 10)) {
    if (!n.name || !n.definition || !n.example || !n.whyImportant) {
      throw new Error('骨架节点缺少关键字段：' + JSON.stringify(n).slice(0, 120))
    }
    if (!Array.isArray(n.parentPath)) {
      throw new Error('骨架节点 parentPath 不是数组：' + n.name)
    }
  }
  if (data.nodes.length > 200) {
    throw new Error('骨架节点数超出上限：' + data.nodes.length)
  }
}

export async function aiGenerateTree(
  line: LearningLine,
  session: OnboardingSession,
  opts: { rebuildDemo?: boolean; onProgress?: (percent: number, msg: string) => void } = {}
): Promise<GenerateTreeResult> {
  const settings = await getSettings()
  if (isDemoMode(settings)) {
    // 只有真正的演示模式（无 API Key）才允许使用内置模板
    const spec = opts.rebuildDemo ? (demoSpecForTitle(line.title) ?? demoTreeSpec(line.title, line.reason)) : demoTreeSpec(line.title, line.reason)
    const nodes = specToNodes(spec, line.id)
    // 演示模式下也尊重自评：勾了「会」的项标记为已掌握
    const knownNames = session.checklist.filter((c) => c.state === 'known').map((c) => c.name)
    const fuzzyNames = session.checklist.filter((c) => c.state === 'fuzzy').map((c) => c.name)
    nodes.forEach((n) => {
      if (knownNames.some((k) => n.name.includes(k.replace(/[「」]/g, '')) || k.includes(n.name))) n.state = 'mastered'
      else if (fuzzyNames.some((k) => n.name.includes(k.replace(/[「」]/g, '')) || k.includes(n.name))) n.state = 'fuzzy'
    })
    return {
      nodes,
      note: opts.rebuildDemo
        ? '演示模式：未配置 API Key，已用内置演示能力图谱重建（配置 Key 后才会个性化生成）'
        : '演示模式：未配置 API Key，使用内置模板生成（配置 Key 后才会个性化生成）',
      meta: {
        source: 'demo',
        model: '内置模板',
        generatedAt: Date.now(),
        skeletonAttempts: 1,
        decompositionCalls: 0,
        stopReason: 'demo_mode',
        complete: true
      }
    }
  }

  // ===== 真实 AI 模式：失败必须大声报错，绝不静默回退模板 =====
  const history = session.messages.map((m) => (m.role === 'ai' ? '教练' : '学员') + '：' + m.text).join('\n')
  const known = session.checklist.filter((c) => c.state === 'known').map((c) => c.name)
  const fuzzy = session.checklist.filter((c) => c.state === 'fuzzy').map((c) => c.name)
  const unknown = session.checklist.filter((c) => c.state === 'unknown').map((c) => c.name)
  const model = moduleModel(settings, 'skeleton')
  const userContent = [
    '学习目标：' + line.title,
    '目标规格书（root 必须按这个定义）：',
    '- 终局能力：' + (session.goalSpec?.goal ?? line.title),
    '- 交付物：' + (session.goalSpec?.deliverable ?? '未指定'),
    '- 成功标准：' + (session.goalSpec?.criteria.join('；') ?? '未指定'),
    '学习线定位：' + (CATEGORY_GUIDE[line.category ?? 'expert'] ?? CATEGORY_GUIDE.expert),
    '学习动机：' + (line.reason || '未说明'),
    '摸底对话：\n' + history,
    '前置概念自评：',
    '- 已会：' + (known.join('、') || '无'),
    '- 模糊：' + (fuzzy.join('、') || '无'),
    '- 不会：' + (unknown.join('、') || '无'),
    '请生成能力图谱骨架。'
  ].join('\n')

  let lastErr: Error | null = null
  let rawSnippet = ''
  let skeletonMs = 0
  const t0 = Date.now()
  for (let attempt = 1; attempt <= 2; attempt++) {
    // 阶段 1：请求发出，等待响应（期间每 2 秒回报已等待秒数）
    opts.onProgress?.(5, '正在请求骨架模型（' + model + '）…')
    const ticker = setInterval(() => {
      opts.onProgress?.(5, '正在等待骨架模型（' + model + '）响应…已等待 ' + Math.round((Date.now() - t0) / 1000) + ' 秒')
    }, 2000)
    let answer: string
    try {
      answer = await deepseekChat(
        settings,
        [{ role: 'system', content: treeSystemPrompt(settings.depth) }, { role: 'user', content: userContent }],
        {
          json: true,
          temperature: 0.5,
          maxTokens: 8192,
          model,
          thinking: settings.skeletonNoThinking ? 'disabled' : undefined
        }
      )
    } finally {
      clearInterval(ticker)
    }
    // 阶段 2：收到响应
    opts.onProgress?.(10, '已收到响应（累计 ' + ((Date.now() - t0) / 1000).toFixed(1) + 's），正在解析 JSON…')
    rawSnippet = answer.slice(0, 800)
    try {
      const data = extractJson<{ root: GenNode; nodes: GenNode[] }>(answer)
      // 阶段 3：结构校验
      opts.onProgress?.(15, 'JSON 解析成功，正在校验能力图谱结构…')
      validateSkeleton(data)
      skeletonMs = Date.now() - t0
      const all: GenNode[] = [data.root, ...data.nodes.slice(0, 200)]
      opts.onProgress?.(20, '骨架完成：' + (1 + all.length) + ' 个初始能力（用时 ' + (skeletonMs / 1000).toFixed(1) + 's）')
      return {
        nodes: genNodesToTree(all, line.id),
        meta: {
          source: 'ai',
          model,
          generatedAt: Date.now(),
          skeletonAttempts: attempt,
          decompositionCalls: 0,
          stopReason: 'skeleton_only',
          complete: true,
          skeletonMs,
          modelsUsed: { skeleton: model }
        }
      }
    } catch (e) {
      lastErr = e as Error
      console.error('[skeleton] 第 ' + attempt + ' 次解析/校验失败', e, '原始返回片段：', rawSnippet)
      if (attempt === 1) {
        opts.onProgress?.(10, '第 1 次骨架校验失败（' + (e as Error).message.slice(0, 60) + '），正在重试 2/2…')
      }
    }
  }
  throw new Error(
    '能力图谱生成失败：模型 ' + model + ' 连续 2 次返回无法解析的内容（可能是 JSON 被截断或结构不符）。最后错误：' +
      (lastErr?.message ?? '未知') +
      '。原始返回片段：' +
      rawSnippet.slice(0, 200)
  )
}


function genNodesToTree(all: GenNode[], lineId: string): TreeNode[] {
  const now = Date.now()
  const byPath = new Map<string, TreeNode>()
  const result: TreeNode[] = []
  all.forEach((g, i) => {
    const parents = i === 0 ? [] : (g.parentPath ?? [])
    const parent = i === 0 ? null : byPath.get(parents.join('/')) ?? null
    const node: TreeNode = {
      id: uid(),
      lineId,
      parentId: parent?.id ?? null,
      name: g.name.trim(),
      definition: g.definition.trim(),
      example: g.example.trim(),
      whyImportant: g.whyImportant.trim(),
      principle: g.principle?.trim(),
      pitfalls: (g.pitfalls ?? []).map((p) => p.trim()).filter(Boolean),
      minutes: g.minutes,
      test: g.test?.trim(),
      practice: g.practice?.trim(),
      state: i === 0 ? 'learning' : g.mastered ? 'mastered' : g.fuzzy ? 'fuzzy' : 'unlearned',
      edgeWhy: null,
      edgeExamples: [],
      edgeLit: false,
      createdAt: now,
      updatedAt: now
    }
    byPath.set([...parents, g.name.trim()].join('/'), node)
    result.push(node)
  })
  return result
}

function specNode(spec: DemoNodeSpec, lineId: string, parentId: string | null): TreeNode {
  const now = Date.now()
  return {
    id: uid(),
    lineId,
    parentId,
    name: spec.name,
    definition: spec.definition,
    example: spec.example,
    whyImportant: spec.whyImportant,
    principle: spec.principle,
    pitfalls: spec.pitfalls ?? [],
    minutes: spec.minutes,
    test: spec.test,
    practice: spec.practice,
    state: spec.state ?? 'unlearned',
    edgeWhy: spec.edgeWhy ?? null,
    edgeExamples: spec.edgeExamples ?? [],
    edgeLit: !!spec.edgeWhy,
    createdAt: now,
    updatedAt: now
  }
}

function specToNodes(spec: DemoNodeSpec, lineId: string): TreeNode[] {
  const result: TreeNode[] = []
  const queue: { spec: DemoNodeSpec; parentId: string | null }[] = [{ spec, parentId: null }]
  while (queue.length > 0) {
    const item = queue.shift()!
    const node = specNode(item.spec, lineId, item.parentId)
    result.push(node)
    ;(item.spec.children ?? []).forEach((c) => queue.push({ spec: c, parentId: node.id }))
  }
  return result
}

// ---- 3.5 学习线分类引导 ----

const CATEGORY_GUIDE: Record<LineCategory, string> = {
  expert: '六个月专家线：目标是用半年时间成为该领域的专家，路线要系统、有深度、可执行，重点放在核心能力闭环上。',
  hobby: '兴趣爱好线：目标是享受学习过程，内容要轻松有趣、贴近生活、压力小，随时可以捡起来学一点。',
  career: '技术栈线：目标是补足专业所需的技能，强调与已有知识和工作场景的衔接，学了就要能用上。'
}

// ---- 4. 继续分解：把任意节点拆成更细小的知识领域（含「已是最小单元」判断） ----

const DECOMPOSE_SYSTEM = [
  '你是学习能力建模教练。你的任务是把「能力」拆成可独立验证的原子学习单元，而不是列知识主题。',
  '能力必须写成「能 + 动词 + 宾语」的形式（例如：能实现 causal self-attention），禁止抽象分类标签。',
  '原子学习单元的硬性定义（全部满足才输出 done:true）：',
  '1. 只包含一个核心概念，名称里不允许出现「与 / 和 / 及 / 、」等连接词；',
  '2. 30~90 分钟内能学会（minutes 字段）；',
  '3. 能设计一道独立测试题验证掌握（test 字段：具体的、第三人可判定的掌握标准）；',
  '4. 能设计一个最小实践任务（practice 字段）。',
  '如果 X 满足以上全部条件，输出：{"done": true, "reason": "一句话说明为什么它已经是最小单元"}',
  '否则输出：{"nodes": [{"name": "能…", "definition": "...", "example": "...", "whyImportant": "...", "principle": "...", "minutes": 45, "test": "...", "practice": "..."}]}',
  '硬性要求：',
  '1. 能拆则拆成 3~6 个子能力；',
  '2. 每个子能力必须满足「完全没接触过的人 30~90 分钟内能学会并通过一次独立测试」，达不到就继续拆；',
  '3. 子能力之间不重叠，合起来能完整覆盖 X；',
  '4. 用通俗中文，面向新手；example 必须具体；',
  '5. 只输出 JSON，不要输出任何解释。'
].join('\n')

interface DecomposeNode {
  name: string
  definition: string
  example: string
  whyImportant: string
  principle?: string
  pitfalls?: string[]
  minutes?: number
  test?: string
  practice?: string
}

/** 原子性硬判定（代码级）：名称含连接词 = 复合能力，必须继续拆 */
const CONNECTOR_RE = /与|和|及|、|，|以及|并且/
export function nodeNameIsAtomic(name: string): boolean {
  return !CONNECTOR_RE.test(name)
}

/** 原子单元完整判定：单概念 + 30~90 分钟 + 有独立测试 + 有最小实践 */
export function nodeIsAtomic(n: TreeNode): boolean {
  return (
    nodeNameIsAtomic(n.name) &&
    (n.minutes ?? 0) >= 30 &&
    (n.minutes ?? 0) <= 90 &&
    !!n.test &&
    !!n.practice
  )
}
export interface DecomposeResult {
  done: boolean
  reason?: string
  children: TreeNode[]
  /** AI 判定 done 但缺原子字段时，返回补齐的字段（由调用方写回节点） */
  fill?: { minutes: number; test: string; practice: string }
}

function decomposeNodesToTree(g: DecomposeNode[], parent: TreeNode, now: number): TreeNode[] {
  return g.slice(0, 8).map((it) => ({
    id: uid(),
    lineId: parent.lineId,
    parentId: parent.id,
    name: it.name.trim(),
    definition: it.definition.trim(),
    example: it.example.trim(),
    whyImportant: it.whyImportant.trim(),
    principle: it.principle?.trim(),
    pitfalls: (it.pitfalls ?? []).map((p) => p.trim()).filter(Boolean),
    minutes: it.minutes,
    test: it.test?.trim(),
    practice: it.practice?.trim(),
    state: 'unlearned' as const,
    edgeWhy: null,
    edgeExamples: [],
    edgeLit: false,
    createdAt: now,
    updatedAt: now
  }))
}

/** 尝试分解一个节点：AI 判断它是否已经是最小知识单元 */
export async function aiTryDecompose(parent: TreeNode, lineTitle: string): Promise<DecomposeResult> {
  const settings = await getSettings()
  if (isDemoMode(settings)) {
    return { done: false, children: demoDecompose(parent.name).map((s) => specNode(s, parent.lineId, parent.id)) }
  }
  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: DECOMPOSE_SYSTEM },
      {
        role: 'user',
        content: [
          '学习目标（树根）：' + lineTitle,
          '要判断的概念 X：' + parent.name,
          'X 的定义：' + parent.definition,
          'X 的例子：' + parent.example,
          'X 的原理：' + (parent.principle || '（未提供）'),
          '请判断 X 是否还能继续分解，能拆就给出子概念，不能拆就给出 done。'
        ].join('\n')
      }
    ],
    { json: true, temperature: 0.5, maxTokens: 2000, model: moduleModel(settings, 'decompose'), thinking: settings.decomposeNoThinking ? 'disabled' : undefined }
  )
  try {
    const data = extractJson<{ done?: boolean; reason?: string; nodes?: DecomposeNode[] }>(answer)
    if (data.done) {
      // ===== P0：代码拥有最终停止权 =====
      // 1) 名称含连接词 = 复合能力，无论 AI 怎么说都必须继续拆
      if (!nodeNameIsAtomic(parent.name)) {
        const retry = await deepseekChat(
          settings,
          [
            { role: 'system', content: DECOMPOSE_SYSTEM },
            {
              role: 'user',
              content:
                '要判断的概念 X：' +
                parent.name +
                '\nX 的定义：' +
                parent.definition +
                '\n注意：X 的名称里含有连接词（与/和/及/、），说明它仍是复合能力，不符合原子单元定义，必须继续拆成单一能力。请输出 nodes。'
            }
          ],
          { json: true, temperature: 0.5, maxTokens: 2000, model: moduleModel(settings, 'decompose'), thinking: settings.decomposeNoThinking ? 'disabled' : undefined }
        )
        try {
          const d2 = extractJson<{ nodes?: DecomposeNode[] }>(retry)
          if (d2.nodes && d2.nodes.length > 0) {
            return { done: false, children: decomposeNodesToTree(d2.nodes, parent, Date.now()) }
          }
        } catch (e2) {
          console.warn('强制再拆也失败', e2)
        }
        throw new Error('分解失败：节点名称含连接词但 AI 两次都未能拆分（' + parent.name + '）')
      }
      // 2) 名称 OK 但缺原子字段（minutes/test/practice 不达标）→ 要求补齐或继续拆
      if (!nodeIsAtomic(parent)) {
        const retry = await deepseekChat(
          settings,
          [
            { role: 'system', content: DECOMPOSE_SYSTEM },
            {
              role: 'user',
              content:
                '要判断的概念 X：' +
                parent.name +
                '（定义：' +
                parent.definition +
                '）\n' +
                '代码校验发现 X 尚不满足原子单元定义（需要：单一概念名称 + 30~90 分钟 + 独立测试 test + 最小实践 practice）。\n' +
                '请二选一：\n' +
                'A. 如果 X 已经足够小，补齐原子字段并输出：{"done": true, "minutes": 45, "test": "...", "practice": "...", "reason": "..."}\n' +
                'B. 如果 X 太大，输出：{"nodes": [子能力...]}'
            }
          ],
          { json: true, temperature: 0.5, maxTokens: 2000, model: moduleModel(settings, 'decompose'), thinking: settings.decomposeNoThinking ? 'disabled' : undefined }
        )
        try {
          const d2 = extractJson<{ done?: boolean; reason?: string; minutes?: number; test?: string; practice?: string; nodes?: DecomposeNode[] }>(retry)
          if (d2.nodes && d2.nodes.length > 0) {
            return { done: false, children: decomposeNodesToTree(d2.nodes, parent, Date.now()) }
          }
          if (d2.done && d2.minutes && d2.test && d2.practice) {
            const fill = { minutes: d2.minutes, test: d2.test.trim(), practice: d2.practice.trim() }
            const temp: TreeNode = { ...parent, ...fill }
            if (nodeIsAtomic(temp)) {
              return { done: true, reason: d2.reason ?? data.reason, children: [], fill }
            }
          }
        } catch (e2) {
          console.warn('原子字段补齐失败', e2)
        }
        throw new Error('分解失败：AI 判定 done 但节点不满足原子定义，补齐/拆分重试也失败（' + parent.name + '）')
      }
      return { done: true, reason: data.reason, children: [] }
    }
    if (data.nodes && data.nodes.length > 0) {
      return { done: false, children: decomposeNodesToTree(data.nodes, parent, Date.now()) }
    }
    return { done: true, reason: 'AI 认为它已无需再分解', children: [] }
  } catch (e) {
    console.error('分解请求解析失败', e)
    throw new Error('分解失败：AI 返回无法解析的内容（' + parent.name + '）：' + (e as Error).message)
  }
}

/** 手动「继续分解」按钮使用：返回分解结果（done 时 children 为空） */
export async function aiDecomposeNode(parent: TreeNode, lineTitle: string): Promise<DecomposeResult> {
  return aiTryDecompose(parent, lineTitle)
}

/** 自动深度分解：逐轮扫描叶子（每轮 24 个、8 路并发），把还能拆的概念继续拆到底（或达到上限） */
/** 分解结果报告：明确「为什么停止」，而不是笼统地说完成 */
export interface DecomposeReport {
  /** 所有叶子都被判定为原子单元（真·拆到底） */
  frontierExhausted: boolean
  /** 操作预算耗尽（还有叶子没处理完） */
  budgetExceeded: boolean
  /** 达到节点总数上限 */
  maxNodesExceeded: boolean
  processed: number
  added: number
  /** 分解请求失败次数（AI 返回无法解析等） */
  failures: number
}

export async function aiAutoDecompose(
  line: LearningLine,
  nodes: TreeNode[],
  opts: {
    /** 总分解操作次数预算（代替固定轮数，保证「拆到底」由队列耗尽而非轮数决定） */
    budget?: number
    maxNodes?: number
    onProgress?: (processed: number, budget: number, totalNodes: number) => void
  } = {}
): Promise<{ nodes: TreeNode[]; report: DecomposeReport }> {
  const budget = opts.budget ?? 120
  const maxNodes = opts.maxNodes ?? 300
  const CONCURRENCY = 8
  const doneIds = new Set<string>()
  let current = nodes
  let processed = 0
  let added = 0
  let failures = 0

  const childrenOf = (list: TreeNode[]): Map<string, TreeNode[]> => {
    const cm = new Map<string, TreeNode[]>()
    list.forEach((n) => cm.set(n.id, cm.get(n.id) ?? []))
    list.forEach((n) => {
      if (n.parentId && cm.has(n.parentId)) cm.get(n.parentId)!.push(n)
    })
    return cm
  }
  const depthOf = (list: TreeNode[]): Map<string, number> => {
    const dm = new Map<string, number>()
    const walk = (n: TreeNode, d: number) => {
      dm.set(n.id, d)
      ;(childrenOf(list).get(n.id) ?? []).forEach((c) => walk(c, d + 1))
    }
    const root = list.find((n) => !n.parentId) ?? list[0]
    if (root) walk(root, 0)
    return dm
  }

  // Frontier 队列：BFS 逐层拆（先浅后深），保证整棵树粒度均衡
  const collectLeaves = (): TreeNode[] => {
    const cm = childrenOf(current)
    const dm = depthOf(current)
    return current.filter((n) => (cm.get(n.id)?.length ?? 0) === 0 && !doneIds.has(n.id) && (dm.get(n.id) ?? 0) < 12)
  }

  let queue = collectLeaves()
  while (queue.length > 0 && processed < budget && current.length < maxNodes) {
    const batch = queue.splice(0, CONCURRENCY)
    // 批次开始立即回报一次，避免 UI 长时间停在旧数字上
    opts.onProgress?.(processed, budget, current.length)
    await Promise.all(
      batch.map(async (leaf) => {
        processed++
        try {
          const res = await aiTryDecompose(leaf, line.title)
          if (res.fill) {
            const target = current.find((n) => n.id === leaf.id)
            if (target) {
              target.minutes = res.fill.minutes
              target.test = res.fill.test
              target.practice = res.fill.practice
              target.updatedAt = Date.now()
            }
            doneIds.add(leaf.id)
          } else if (res.done) {
            doneIds.add(leaf.id)
          } else if (res.children.length > 0) {
            if (current.length + res.children.length <= maxNodes) {
              current = [...current, ...res.children]
              added += res.children.length
              const dm = depthOf(current)
              queue.push(...res.children.filter((c) => (dm.get(c.id) ?? 0) < 12))
            } else {
              doneIds.add(leaf.id)
            }
          } else {
            doneIds.add(leaf.id)
          }
        } catch (e) {
          console.warn('叶子自动分解失败：', leaf.name, e)
          failures++
          doneIds.add(leaf.id)
        }
        opts.onProgress?.(processed, budget, current.length)
      })
    )
    if (queue.length === 0) queue = collectLeaves()
  }

  const remaining = collectLeaves()
  const report: DecomposeReport = {
    frontierExhausted: remaining.length === 0 && processed < budget && current.length < maxNodes,
    budgetExceeded: processed >= budget && remaining.length > 0,
    maxNodesExceeded: current.length >= maxNodes && remaining.length > 0,
    processed,
    added,
    failures
  }
  return { nodes: current, report }
}
export async function aiBuildDeepTree(
  line: LearningLine,
  session: OnboardingSession,
  opts: { rebuildDemo?: boolean; onProgress?: (percent: number, msg: string) => void } = {}
): Promise<GenerateTreeResult> {
  opts.onProgress?.(3, '准备生成能力图谱…')
  const result = await aiGenerateTree(line, session, {
    rebuildDemo: opts.rebuildDemo,
    onProgress: (p, m) => opts.onProgress?.(p, m)
  })
  const settings = await getSettings()
  if (isDemoMode(settings) || settings.depth !== 'deep') {
    opts.onProgress?.(100, '完成')
    return result
  }
  opts.onProgress?.(20, '骨架完成，开始自动深度分解（真实进度 = 已检查叶子 / 预算）…')
  const before = result.nodes.length
  const budget = 120
  if (!settings.decomposeNoThinking) {
    opts.onProgress?.(21, '分解使用思考模式：每次约 30~90 秒，请耐心等待（可在设置页关闭）')
  }
  const auto = await aiAutoDecompose(line, result.nodes, {
    budget,
    maxNodes: 300,
    onProgress: (processed, totalBudget, totalNodes) => {
      const percent = Math.min(95, 20 + Math.round((processed / Math.max(1, totalBudget)) * 75))
      opts.onProgress?.(percent, '自动深度分解：已判断 ' + processed + ' 个叶子，已生成 ' + totalNodes + ' 个节点')
    }
  })
  result.nodes = auto.nodes
  opts.onProgress?.(100, '完成')
  // 生成溯源：合并分解报告
  result.meta = {
    ...result.meta,
    decompositionCalls: auto.report.processed,
    stopReason: auto.report.frontierExhausted
      ? 'frontier_exhausted'
      : auto.report.maxNodesExceeded
        ? 'max_nodes_exceeded'
        : 'budget_exceeded',
    complete: auto.report.frontierExhausted,
    modelsUsed: {
      skeleton: moduleModel(settings, 'skeleton'),
      decompose: moduleModel(settings, 'decompose'),
      checklist: moduleModel(settings, 'checklist'),
      chat: moduleModel(settings, 'chat'),
      lightEdge: moduleModel(settings, 'lightEdge')
    }
  }
  if (auto.report.failures > 0) {
    result.note = (result.note ? result.note + '；' : '') + '⚠️ 有 ' + auto.report.failures + ' 个叶子分解失败（AI 返回无法解析）'
  }
  if (auto.report.added > 0) {
    const stopNote = auto.report.frontierExhausted
      ? '所有叶子均已拆到原子单元（真·拆到底）'
      : auto.report.maxNodesExceeded
        ? '达到节点上限 ' + 300 + '（仍有叶子未拆完）'
        : '分解预算耗尽（' + budget + ' 次操作，仍有叶子未拆完）'
    result.note = (result.note ? result.note + '；' : '') + '已自动深度分解：' + before + ' → ' + result.nodes.length + ' 个节点。' + stopNote
  }
  return result
}


// ---- 4.5 证据式诊断：出题 + 评分 ----

const QUIZ_SYSTEM = [
  '你是学习诊断教练。为给定的原子能力节点出一道「诊断题」，用于检验用户是否真的掌握（而不是自我感觉）。',
  '输出 JSON：{"question": "一道具体的题目", "rubric": "评分要点（1~3 条）"}',
  '要求：',
  '1. question 要求用户实际写出/动手回答，不能是选择题或「你懂吗」；',
  '2. 紧扣该能力的最小可验证行为（如「给出 X 的 shape」）；',
  '3. rubric 是给评分者看的要点，具体可判定。'
].join('\n')

export interface QuizItem {
  nodeId: string
  question: string
  rubric: string
}

export async function aiBuildDiagnosticQuiz(line: LearningLine, targets: TreeNode[]): Promise<QuizItem[]> {
  const settings = await getSettings()
  if (isDemoMode(settings)) {
    return targets.map((t) => ({
      nodeId: t.id,
      question: '请用自己的话解释「' + t.name + '」是什么，并给出一个具体例子。',
      rubric: '能说清定义 + 给出具体例子即通过。'
    }))
  }
  const results = await Promise.all(
    targets.map(async (t) => {
      const answer = await deepseekChat(
        settings,
        [
          { role: 'system', content: QUIZ_SYSTEM },
          {
            role: 'user',
            content:
              '学习目标：' +
              line.title +
              '\n能力节点：「' +
              t.name +
              '」\n定义：' +
              t.definition +
              '\n掌握标准（test）：' +
              (t.test ?? '未提供') +
              '\n请出一道诊断题。'
          }
        ],
        { json: true, temperature: 0.6, model: moduleModel(settings, 'checklist') }
      )
      try {
        const data = extractJson<{ question: string; rubric: string }>(answer)
        return { nodeId: t.id, question: data.question.trim(), rubric: (data.rubric ?? '').trim() }
      } catch (e) {
        console.warn('诊断题解析失败，使用通用题', e)
        return { nodeId: t.id, question: '请用自己的话解释「' + t.name + '」，并给出一个具体例子。', rubric: '能说清定义 + 给出具体例子即通过。' }
      }
    })
  )
  return results
}

const EVAL_SYSTEM = [
  '你是严格的诊断评分员。根据评分要点，对用户的答案打分。',
  '输出 JSON：{"score": 78, "feedback": "一句反馈"}',
  '要求：',
  '1. score 是 0~100 的整数，严格按要点给分；',
  '2. feedback 一句话：先说哪里对，再说缺什么。'
].join('\n')

export interface QuizResult {
  nodeId: string
  score: number
  feedback: string
}

export async function aiEvaluateAnswer(line: LearningLine, item: QuizItem, answer: string): Promise<QuizResult> {
  const settings = await getSettings()
  if (isDemoMode(settings)) {
    const text = answer.trim()
    const score = text.length === 0 ? 0 : text.length > 30 ? 70 : 40
    return {
      nodeId: item.nodeId,
      score,
      feedback: score >= 60 ? '演示模式：答案有一定内容，视为基本掌握。' : '演示模式：答案太简短，建议补充分数不足。'
    }
  }
  const res = await deepseekChat(
    settings,
    [
      { role: 'system', content: EVAL_SYSTEM },
      {
        role: 'user',
        content:
          '学习目标：' +
          line.title +
          '\n能力节点：「' +
          item.nodeId +
          '」\n题目：' +
          item.question +
          '\n评分要点：' +
          item.rubric +
          '\n用户答案：\n' +
          answer.trim() +
          '\n请评分。'
      }
    ],
    { json: true, temperature: 0.3, model: moduleModel(settings, 'checklist') }
  )
  try {
    const data = extractJson<{ score: number; feedback: string }>(res)
    return { nodeId: item.nodeId, score: Math.max(0, Math.min(100, Math.round(Number(data.score) || 0))), feedback: (data.feedback ?? '').trim() }
  } catch (e) {
    console.warn('评分解析失败', e)
    return { nodeId: item.nodeId, score: 50, feedback: '评分失败，按 50 分计入。' }
  }
}

// ---- 5. 点亮边：生成「为什么关联 + 相似例子」 ----

const LIGHT_SYSTEM = [
  '你是知识图谱学习教练。用户刚学完概念 A，知识树要从 A 引出下一个概念 B。',
  '输出 JSON：{"edgeWhy": "...", "examples": ["...", "..."]}',
  '要求：',
  '1. edgeWhy 用一两句通俗的话讲清楚：从 A 的哪些例子/练习中会自然遇到 B，两者的关联是什么；',
  '2. examples 是 A 的 2~3 个相似/延伸例子，每个例子中 B 自然出现，要具体（带数字或场景）；',
  '3. 只输出 JSON。'
].join('\n')

export async function aiLightEdge(
  parent: Pick<TreeNode, 'name' | 'definition' | 'example'>,
  child: Pick<TreeNode, 'name' | 'definition' | 'example'>
): Promise<{ edgeWhy: string; edgeExamples: string[] }> {
  const settings = await getSettings()
  if (isDemoMode(settings)) return demoLightEdge(parent.name, child.name)

  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: LIGHT_SYSTEM },
      {
        role: 'user',
        content: [
          '概念 A（已学）：' + parent.name,
          'A 的定义：' + parent.definition,
          'A 的例子：' + parent.example,
          '概念 B（下一个）：' + child.name,
          'B 的定义：' + child.definition,
          'B 的例子：' + child.example,
          '请生成从 A 到 B 的关联说明与相似例子。'
        ].join('\n')
      }
    ],
    { json: true, temperature: 0.7, model: moduleModel(settings, 'lightEdge') }
  )
  try {
    const data = extractJson<{ edgeWhy: string; examples: string[] }>(answer)
    if (data.edgeWhy && Array.isArray(data.examples) && data.examples.length > 0) {
      return { edgeWhy: data.edgeWhy.trim(), edgeExamples: data.examples.slice(0, 4).map((e) => e.trim()) }
    }
  } catch (e) {
    console.error('解析边说明失败', e)
    throw new Error('边点亮失败：AI 返回无法解析的内容（' + (e as Error).message + '）')
  }
  throw new Error('边点亮失败：AI 返回缺少 edgeWhy 或 examples')
}

// ---- 费曼 3×30：复述点评 / 应用出题 / 答题评分 ----

const FEYNMAN_RETELL_SYSTEM = [
  '你是费曼学习法教练。用户正在复述一个概念，你要对照参考材料找出他理解上的缺口，而不是批改作文。',
  '输出 JSON：{"score": 0~100 整数, "strengths": ["讲得好的点，最多3条"], "gaps": ["遗漏或说错的关键点，最多5条"], "suggestion": "下一步建议，一句话"}',
  '评分标准：',
  '1. 覆盖了定义、原理、为什么重要的核心要点（每缺一个关键点扣分）；',
  '2. 用自己的话而不是照抄原文（照抄不扣光但提示）；',
  '3. 有具体例子支撑（有例子加分）；',
  '4. 讲错了关键事实要重扣并列入 gaps。',
  '只输出 JSON。'
].join('\n')

const FEYNMAN_TASKS_SYSTEM = [
  '你是费曼学习法教练，负责出「举例应用」题检验用户是否真的会用某个概念。',
  '输出 JSON：{"tasks": [{"question": "一道应用场景题，逼用户把概念用起来", "hint": "可选提示，30 字内"}]}',
  '要求：',
  '1. 出 2~3 道题，从易到难；',
  '2. 题目要落在「把概念用于真实场景」，而不是复述定义；',
  '3. 优先结合概念自带的最小实践任务与掌握标准出题；',
  '4. 只输出 JSON。'
].join('\n')

const FEYNMAN_ANSWER_SYSTEM = [
  '你是费曼学习法教练，正在给用户的「举例应用」作答打分。',
  '输出 JSON：{"score": 0~100 整数, "strengths": ["答得好的点，最多2条"], "gaps": ["漏洞或错误，最多3条"], "suggestion": "一句话建议"}',
  '评分标准：答案是否真正用上了该概念、步骤是否可执行、有没有暴露理解错误。',
  '只输出 JSON。'
].join('\n')

/** 解析 AI 返回的费曼点评 JSON */
function parseFeynmanFeedback(answer: string, failMsg: string): FeynmanFeedback {
  try {
    const data = extractJson<{ score?: unknown; strengths?: unknown; gaps?: unknown; suggestion?: unknown }>(answer)
    const score = Math.max(0, Math.min(100, Math.round(Number(data.score ?? NaN))))
    const strengths = Array.isArray(data.strengths) ? data.strengths.slice(0, 3).map(String).map((s) => s.trim()).filter(Boolean) : []
    const gaps = Array.isArray(data.gaps) ? data.gaps.slice(0, 5).map(String).map((s) => s.trim()).filter(Boolean) : []
    const suggestion = typeof data.suggestion === 'string' ? data.suggestion.trim() : ''
    if (!Number.isFinite(score)) throw new Error('score 不是数字')
    return { score, strengths, gaps, suggestion }
  } catch (e) {
    console.error('费曼点评解析失败', e)
    throw new Error(failMsg + '（' + (e as Error).message + '）')
  }
}

/** 复述点评：对照节点材料找出理解缺口 */
export async function aiFeynmanRetellFeedback(
  node: Pick<TreeNode, 'name' | 'definition' | 'principle' | 'example'>,
  retell: string
): Promise<FeynmanFeedback> {
  const settings = await getSettings()
  if (isDemoMode(settings)) return demoFeynmanRetellFeedback(node, retell)
  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: FEYNMAN_RETELL_SYSTEM },
      {
        role: 'user',
        content: [
          '概念：' + node.name,
          '定义：' + node.definition,
          node.principle ? '原理：' + node.principle : '',
          '例子：' + node.example,
          '',
          '用户的复述：',
          retell,
          '',
          '请对照材料点评这份复述。'
        ].filter(Boolean).join('\n')
      }
    ],
    { json: true, temperature: 0.5, model: moduleModel(settings, 'feynman') }
  )
  return parseFeynmanFeedback(answer, '复述点评失败：AI 返回无法解析的内容')
}

/** 应用出题：生成 2~3 道应用场景题 */
export async function aiFeynmanTasks(
  node: Pick<TreeNode, 'name' | 'definition' | 'test' | 'practice'>
): Promise<FeynmanTask[]> {
  const settings = await getSettings()
  if (isDemoMode(settings)) return demoFeynmanTasks(node)
  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: FEYNMAN_TASKS_SYSTEM },
      {
        role: 'user',
        content: [
          '概念：' + node.name,
          '定义：' + node.definition,
          node.practice ? '最小实践任务：' + node.practice : '',
          node.test ? '掌握标准：' + node.test : '',
          '请出 2~3 道应用场景题。'
        ].filter(Boolean).join('\n')
      }
    ],
    { json: true, temperature: 0.7, model: moduleModel(settings, 'feynman') }
  )
  try {
    const data = extractJson<{ tasks?: unknown }>(answer)
    const tasks = Array.isArray(data.tasks)
      ? data.tasks
          .map((t) => (typeof t === 'object' && t !== null ? (t as Record<string, unknown>) : null))
          .filter((t): t is Record<string, unknown> => t !== null && typeof t.question === 'string' && t.question.trim().length > 0)
          .slice(0, 3)
          .map((t, i) => ({
            id: 't' + (i + 1),
            question: (t.question as string).trim(),
            ...(typeof t.hint === 'string' && t.hint.trim() ? { hint: (t.hint as string).trim() } : {})
          }))
      : []
    if (tasks.length >= 2) return tasks
  } catch (e) {
    console.error('应用出题解析失败', e)
    throw new Error('应用出题失败：AI 返回无法解析的内容（' + (e as Error).message + '）')
  }
  throw new Error('应用出题失败：AI 返回的题目不足 2 道')
}

/** 答题评分：对照题目与该概念的掌握标准 */
export async function aiFeynmanAnswerFeedback(
  node: Pick<TreeNode, 'name' | 'test'>,
  task: FeynmanTask,
  answer: string
): Promise<FeynmanFeedback> {
  const settings = await getSettings()
  if (isDemoMode(settings)) return demoFeynmanAnswerFeedback(node, task, answer)
  const res = await deepseekChat(
    settings,
    [
      { role: 'system', content: FEYNMAN_ANSWER_SYSTEM },
      {
        role: 'user',
        content: [
          '概念：' + node.name,
          node.test ? '掌握标准：' + node.test : '',
          '题目：' + task.question,
          task.hint ? '提示：' + task.hint : '',
          '',
          '用户的作答：',
          answer,
          '',
          '请评分并给出反馈。'
        ].filter(Boolean).join('\n')
      }
    ],
    { json: true, temperature: 0.5, model: moduleModel(settings, 'feynman') }
  )
  return parseFeynmanFeedback(res, '答题评分失败：AI 返回无法解析的内容')
}

// ---- 每周复盘：学习数据总结与下周建议 ----

const WEEKLY_REVIEW_SYSTEM = [
  '你是学习复盘教练。你会收到一周的学习数据统计，请输出一段 150 字以内的中文复盘。',
  '要求：',
  '1. 先肯定本周做得好的地方（具体到数字）；',
  '2. 指出最值得改进的一点（结合费曼平均分与连续天数）；',
  '3. 给出下周的一条具体行动建议（可执行、可检验）；',
  '4. 语气鼓励但不空洞，不要客套，不要用标题或列表，直接成段。'
].join('\n')

/** 每周复盘：根据本周统计数据生成总结与下周建议 */
export async function aiWeeklyReview(stats: WeekStats): Promise<string> {
  const settings = await getSettings()
  if (isDemoMode(settings)) return demoWeeklyReview(stats)
  return await deepseekChat(
    settings,
    [
      { role: 'system', content: WEEKLY_REVIEW_SYSTEM },
      {
        role: 'user',
        content:
          '本周学习数据：掌握概念 ' + stats.nodeMastered + ' 次、点亮关联 ' + stats.edgeLit + ' 次、完成费曼学习 ' +
          stats.feynmanDone + ' 次、生成学习计划 ' + stats.planGenerated + ' 次；费曼复述平均分 ' + stats.avgFeynmanScore +
          '；当前连续学习 ' + stats.streak + ' 天。请给出本周复盘。'
      }
    ],
    { temperature: 0.6, maxTokens: 500, model: moduleModel(settings, 'review') }
  )
}

// ---- 高维认知解读：认知升级后重新理解同一知识 ----

const HIGHDIM_SYSTEM = [
  '你是认知升级教练。用户已经掌握了一批概念，现在要用更高的视角重新理解其中一个旧概念。',
  '请输出 150 字以内的中文解读，按以下结构：',
  '1. 一句「更高维度」的本质概括（这个概念的深层原理/它在更大图景里的位置）；',
  '2. 指出它和用户已掌握概念之间的一条暗线联系；',
  '3. 一句「下次认知再升级时你会看到什么」。',
  '不要列表，直接成段；不要复述定义；通俗而深刻。'
].join('\n')

/** 高维认知解读：结合用户已掌握的概念重新解读旧概念 */
export async function aiHighDimInterpretation(
  node: Pick<TreeNode, 'name' | 'definition' | 'principle' | 'example'>,
  masteredNames: string[]
): Promise<string> {
  const settings = await getSettings()
  if (isDemoMode(settings)) return demoHighDimInterpretation(node, masteredNames)
  const others = masteredNames.filter((n) => n !== node.name).slice(0, 12)
  return await deepseekChat(
    settings,
    [
      { role: 'system', content: HIGHDIM_SYSTEM },
      {
        role: 'user',
        content:
          '待重新理解的概念：' + node.name + '\n它的定义：' + node.definition +
          (node.principle ? '\n它的原理：' + node.principle : '') +
          '\n它的例子：' + node.example +
          (others.length > 0 ? '\n用户已掌握的概念：' + others.join('、') : '\n用户目前没有其他已掌握的概念。') +
          '\n请给出高维认知解读。'
      }
    ],
    { temperature: 0.7, maxTokens: 400, model: moduleModel(settings, 'highdim') }
  )
}
