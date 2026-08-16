// ---------- AI 编排：有 API Key 走 DeepSeek，没有则走演示模板 ----------

import { getSettings, uid } from '../db'
import type { LearningLine, TreeNode, OnboardingSession, ChecklistItem, DecomposeDepth, LineCategory } from '../types'
import { deepseekChat, extractJson } from './deepseek'
import { demoChatQuestion, demoChecklist, demoTreeSpec, demoLightEdge, demoDecompose, demoSpecForTitle, type DemoNodeSpec } from './demo'

export function isDemoMode(settings: { apiKey: string }): boolean {
  return !settings.apiKey
}

// ---- 1. 摸底聊天：AI 提出下一轮问题 ----

const CHAT_SYSTEM = [
  '你是友好耐心的学习摸底教练。你正在了解用户的学习基础，为定制学习路线做准备。',
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
  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: CHAT_SYSTEM.replace('{round}', String(session.round + 1)) },
      {
        role: 'user',
        content: '用户想学：' + line.title + '（动机：' + (line.reason || '未说明') + '）。\n' + (history.length ? '之前的对话：' : '')
      },
      ...history,
      { role: 'user', content: '请提出下一个摸底问题。' }
    ],
    { temperature: 0.8 }
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
    { json: true, temperature: 0.4 }
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
    { json: true, temperature: 0.4 }
  )
  try {
    const data = extractJson<{ items: { name: string }[] }>(answer)
    const items = data.items
      .slice(0, 15)
      .map((it) => ({ id: uid(), name: it.name.trim(), state: 'unknown' as const }))
    if (items.length > 0) return items
  } catch (e) {
    console.warn('解析诊断清单失败，回退演示清单', e)
  }
  return demoChecklist(line.title)
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
  /** 需要提示用户的信息（演示模式 / 解析回退说明） */
  note?: string
}

export async function aiGenerateTree(
  line: LearningLine,
  session: OnboardingSession,
  opts: { rebuildDemo?: boolean } = {}
): Promise<GenerateTreeResult> {
  const settings = await getSettings()
  if (isDemoMode(settings)) {
    // 重新构建时：内置演示线恢复原始演示树，其余用通用模板
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
        ? '演示模式：未配置 API Key，已用内置演示知识树重建（配置 Key 后才会个性化生成）'
        : '演示模式：未配置 API Key，使用内置模板生成（配置 Key 后才会个性化生成）'
    }
  }

  const history = session.messages.map((m) => (m.role === 'ai' ? '教练' : '学员') + '：' + m.text).join('\n')
  const known = session.checklist.filter((c) => c.state === 'known').map((c) => c.name)
  const fuzzy = session.checklist.filter((c) => c.state === 'fuzzy').map((c) => c.name)
  const unknown = session.checklist.filter((c) => c.state === 'unknown').map((c) => c.name)
  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: treeSystemPrompt(settings.depth) },
      {
        role: 'user',
        content: [
          '学习目标：' + line.title,
          '学习线定位：' + (CATEGORY_GUIDE[line.category ?? 'expert'] ?? CATEGORY_GUIDE.expert),
          '学习动机：' + (line.reason || '未说明'),
          '摸底对话：\n' + history,
          '前置概念自评：',
          '- 已会：' + (known.join('、') || '无'),
          '- 模糊：' + (fuzzy.join('、') || '无'),
          '- 不会：' + (unknown.join('、') || '无'),
          '请生成知识树。'
        ].join('\n')
      }
    ],
    { json: true, temperature: 0.5, maxTokens: settings.depth === 'deep' ? 3000 : 4096 }
  )
  try {
    const data = extractJson<{ root: GenNode; nodes: GenNode[] }>(answer)
    const all: GenNode[] = [data.root, ...data.nodes.slice(0, 200)]
    return { nodes: genNodesToTree(all, line.id) }
  } catch (e) {
    console.error('解析知识树失败，回退内置模板', e)
    return {
      nodes: specToNodes(demoTreeSpec(line.title, line.reason), line.id),
      note: 'AI 返回的内容解析失败，已用内置模板代替：' + String((e as Error).message).slice(0, 100)
    }
  }
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
    { json: true, temperature: 0.5, maxTokens: 2000 }
  )
  try {
    const data = extractJson<{ done?: boolean; reason?: string; nodes?: DecomposeNode[] }>(answer)
    if (data.done) {
      // 代码级兜底：名称含连接词说明仍是复合能力，AI 误判 done 时强制再拆
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
          { json: true, temperature: 0.5, maxTokens: 2000 }
        )
        try {
          const d2 = extractJson<{ nodes?: DecomposeNode[] }>(retry)
          if (d2.nodes && d2.nodes.length > 0) {
            return { done: false, children: decomposeNodesToTree(d2.nodes, parent, Date.now()) }
          }
        } catch (e2) {
          console.warn('强制再拆也失败，用演示模板兜底', e2)
        }
        return { done: false, children: demoDecompose(parent.name).map((s) => specNode(s, parent.lineId, parent.id)) }
      }
      return { done: true, reason: data.reason, children: [] }
    }
    if (data.nodes && data.nodes.length > 0) {
      return { done: false, children: decomposeNodesToTree(data.nodes, parent, Date.now()) }
    }
    return { done: true, reason: 'AI 认为它已无需再分解', children: [] }
  } catch (e) {
    console.warn('解析分解结果失败', e)
    return { done: true, reason: 'AI 返回内容解析失败，跳过自动分解', children: [] }
  }
}

/** 手动「继续分解」按钮使用：返回分解结果（done 时 children 为空） */
export async function aiDecomposeNode(parent: TreeNode, lineTitle: string): Promise<DecomposeResult> {
  return aiTryDecompose(parent, lineTitle)
}

/** 自动深度分解：逐轮扫描叶子（每轮 24 个、8 路并发），把还能拆的概念继续拆到底（或达到上限） */
export async function aiAutoDecompose(
  line: LearningLine,
  nodes: TreeNode[],
  opts: {
    maxRounds?: number
    maxNodes?: number
    onProgress?: (round: number, doneInRound: number, batchSize: number, totalNodes: number) => void
  } = {}
): Promise<TreeNode[]> {
  const maxRounds = opts.maxRounds ?? 4
  const maxNodes = opts.maxNodes ?? 300
  const CONCURRENCY = 8
  const doneIds = new Set<string>()
  let current = nodes

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

  for (let round = 1; round <= maxRounds; round++) {
    const cm = childrenOf(current)
    const dm = depthOf(current)
    const leaves = current.filter((n) => (cm.get(n.id)?.length ?? 0) === 0 && !doneIds.has(n.id) && (dm.get(n.id) ?? 0) < 12)
    if (leaves.length === 0) break
    const batch = leaves.slice(0, 24)
    let addedInRound = 0
    let doneInRound = 0
    const queue = [...batch]
    await Promise.all(
      Array.from({ length: Math.min(CONCURRENCY, queue.length) }, async () => {
        while (queue.length > 0) {
          const leaf = queue.shift()!
          try {
            const res = await aiTryDecompose(leaf, line.title)
            if (res.done) {
              doneIds.add(leaf.id)
            } else if (res.children.length > 0) {
              if (current.length + res.children.length <= maxNodes) {
                current = [...current, ...res.children]
                addedInRound++
              } else {
                doneIds.add(leaf.id)
              }
            } else {
              doneIds.add(leaf.id)
            }
          } catch (e) {
            console.warn('叶子自动分解失败：', leaf.name, e)
            doneIds.add(leaf.id)
          }
          doneInRound++
          opts.onProgress?.(round, doneInRound, batch.length, current.length)
        }
      })
    )
    if (current.length >= maxNodes) break
    // 本轮没有任何叶子还能拆 → 收工
    if (addedInRound === 0) break
  }
  return current
}

/** 完整构建流程：生成骨架 → （深度模式自动）分解到足够细小。onProgress 回报 0~100 百分比。 */
export async function aiBuildDeepTree(
  line: LearningLine,
  session: OnboardingSession,
  opts: { rebuildDemo?: boolean; onProgress?: (percent: number, msg: string) => void } = {}
): Promise<GenerateTreeResult> {
  opts.onProgress?.(5, '正在生成知识树骨架…')
  const result = await aiGenerateTree(line, session, { rebuildDemo: opts.rebuildDemo })
  const settings = await getSettings()
  if (isDemoMode(settings) || settings.depth !== 'deep') {
    opts.onProgress?.(100, '完成')
    return result
  }
  opts.onProgress?.(20, '骨架完成，开始自动深度分解…')
  const before = result.nodes.length
  const maxRounds = 4
  result.nodes = await aiAutoDecompose(line, result.nodes, {
    maxRounds,
    maxNodes: 300,
    onProgress: (round, doneInRound, batchSize, totalNodes) => {
      const percent = Math.min(95, 20 + (round - 1) * 20 + Math.round((doneInRound / Math.max(1, batchSize)) * 20))
      opts.onProgress?.(percent, '自动深度分解：第 ' + round + ' 轮 ' + doneInRound + '/' + batchSize + '，已生成 ' + totalNodes + ' 个节点')
    }
  })
  opts.onProgress?.(100, '完成')
  if (result.nodes.length > before) {
    result.note = (result.note ? result.note + '；' : '') + '已自动深度分解：' + before + ' → ' + result.nodes.length + ' 个节点（直到 AI 认为无法再拆为止）'
  }
  return result
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
    { json: true, temperature: 0.7 }
  )
  try {
    const data = extractJson<{ edgeWhy: string; examples: string[] }>(answer)
    if (data.edgeWhy && Array.isArray(data.examples) && data.examples.length > 0) {
      return { edgeWhy: data.edgeWhy.trim(), edgeExamples: data.examples.slice(0, 4).map((e) => e.trim()) }
    }
  } catch (e) {
    console.warn('解析边说明失败', e)
  }
  return demoLightEdge(parent.name, child.name)
}
