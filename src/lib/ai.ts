// ---------- AI 编排：有 API Key 走 DeepSeek，没有则走演示模板 ----------

import { getSettings, uid } from '../db'
import type { LearningLine, TreeNode, OnboardingSession, ChecklistItem, DecomposeDepth, LineCategory } from '../types'
import { deepseekChat, extractJson } from './deepseek'
import { demoChatQuestion, demoChecklist, demoTreeSpec, demoLightEdge, demoDecompose, type DemoNodeSpec } from './demo'

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

// ---- 3. 生成知识树骨架（分支不设上限，越详细越好） ----

function treeSystemPrompt(depth: DecomposeDepth): string {
  const rules =
    depth === 'deep'
      ? '1. 树深 5~8 层，总节点数 40~150；每层的分支数量不设上限，越详细越好，宁细勿粗。'
      : '1. 树深 3~5 层，每层 3~7 个分支，总节点数 15~40。'
  return [
    '你是一位知识图谱学习教练。根据用户的学习目标与摸底结果，生成一棵「垂直知识树」（根在上，向下分支）。',
    '输出必须是 JSON，格式：',
    '{',
    '  "root": { "name": "学习目标", "definition": "...", "example": "...", "whyImportant": "...", "principle": "..." },',
    '  "nodes": [',
    '    { "name": "概念名", "definition": "通俗定义", "example": "具体例子", "whyImportant": "为什么重要", "principle": "通俗原理", "parentPath": ["从根到父节点的概念名数组"], "mastered": false, "fuzzy": false }',
    '  ]',
    '}',
    '硬性要求：',
    rules,
    '2. 粒度自适应：每片叶子必须满足「完全没接触过的人 5 分钟内能看懂：一个定义 + 一个原理 + 一个例子 + 一句为什么重要」；不满足就继续分解，宁可分解过头，也不要留下看不懂的叶子。',
    '3. principle 是「这个知识点背后的原理是什么」，用一句最通俗的话解释它为什么成立/为什么这样设计；不要输出易错点、误区等负面内容，只讲正确概念。',
    '4. 用户已掌握的概念仍保留在树上，标记 mastered=true（显示为绿色）；用户模糊的概念标记 fuzzy=true（显示为黄色），不标 mastered。',
    '5. 所有文字用通俗中文，面向该领域新手；definition 1~2 句，example 必须具体（带数字或场景）。',
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
  parentPath: string[]
  mastered?: boolean
  fuzzy?: boolean
}

export async function aiGenerateTree(line: LearningLine, session: OnboardingSession): Promise<TreeNode[]> {
  const settings = await getSettings()
  if (isDemoMode(settings)) {
    const nodes = specToNodes(demoTreeSpec(line.title, line.reason), line.id)
    // 演示模式下也尊重自评：勾了「会」的项标记为已掌握
    const knownNames = session.checklist.filter((c) => c.state === 'known').map((c) => c.name)
    const fuzzyNames = session.checklist.filter((c) => c.state === 'fuzzy').map((c) => c.name)
    nodes.forEach((n) => {
      if (knownNames.some((k) => n.name.includes(k.replace(/[「」]/g, '')) || k.includes(n.name))) n.state = 'mastered'
      else if (fuzzyNames.some((k) => n.name.includes(k.replace(/[「」]/g, '')) || k.includes(n.name))) n.state = 'fuzzy'
    })
    return nodes
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
    { json: true, temperature: 0.5, maxTokens: settings.depth === 'deep' ? 8000 : 4096 }
  )
  try {
    const data = extractJson<{ root: GenNode; nodes: GenNode[] }>(answer)
    const all: GenNode[] = [data.root, ...data.nodes.slice(0, 200)]
    return genNodesToTree(all, line.id)
  } catch (e) {
    console.error('解析知识树失败，回退演示模板', e)
    return specToNodes(demoTreeSpec(line.title, line.reason), line.id)
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

// ---- 4. 继续分解：把任意节点拆成更细小的知识领域 ----

const DECOMPOSE_SYSTEM = [
  '你是知识图谱学习教练。用户觉得概念「X」还不够细，需要把它分解成更细小的知识领域。',
  '输出 JSON：{"nodes": [{"name": "子概念名", "definition": "通俗定义", "example": "具体例子", "whyImportant": "为什么重要", "principle": "通俗原理"}]}',
  '硬性要求：',
  '1. 分解成 3~6 个子概念，分支不设上限；',
  '2. 每个子概念必须满足「完全没接触过的人 5 分钟内能看懂：一个定义 + 一个原理 + 一个例子 + 一句为什么重要」，达不到就拆得更细；',
  '3. 子概念之间不重叠，合起来能完整覆盖「X」；',
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
}

export async function aiDecomposeNode(parent: TreeNode, lineTitle: string): Promise<TreeNode[]> {
  const settings = await getSettings()
  if (isDemoMode(settings)) {
    return demoDecompose(parent.name).map((s) => specNode(s, parent.lineId, parent.id))
  }

  const answer = await deepseekChat(
    settings,
    [
      { role: 'system', content: DECOMPOSE_SYSTEM },
      {
        role: 'user',
        content: [
          '学习目标（树根）：' + lineTitle,
          '要分解的概念 X：' + parent.name,
          'X 的定义：' + parent.definition,
          'X 的例子：' + parent.example,
          'X 的原理：' + (parent.principle || '（未提供）'),
          '请把 X 分解成更细小的知识领域。'
        ].join('\n')
      }
    ],
    { json: true, temperature: 0.5, maxTokens: 4000 }
  )
  try {
    const data = extractJson<{ nodes: DecomposeNode[] }>(answer)
    const now = Date.now()
    return data.nodes.slice(0, 8).map((g) => ({
      id: uid(),
      lineId: parent.lineId,
      parentId: parent.id,
      name: g.name.trim(),
      definition: g.definition.trim(),
      example: g.example.trim(),
      whyImportant: g.whyImportant.trim(),
      principle: g.principle?.trim(),
      pitfalls: (g.pitfalls ?? []).map((p) => p.trim()).filter(Boolean),
      state: 'unlearned' as const,
      edgeWhy: null,
      edgeExamples: [],
      edgeLit: false,
      createdAt: now,
      updatedAt: now
    }))
  } catch (e) {
    console.warn('解析分解结果失败，回退演示模板', e)
    return demoDecompose(parent.name).map((s) => specNode(s, parent.lineId, parent.id))
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
