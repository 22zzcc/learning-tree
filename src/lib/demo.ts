// ---------- 演示数据（未配置 API Key 时使用） ----------
// 三条演示学习线，展示「并行学习线」概念：
//   1. 掌握短除法（小学数学，含四色状态、部分已点亮边、原理与易错点）
//   2. 看懂基础经济新闻（宏观入门，少量已点亮边）
//   3. 自由泳入门（运动技能，全部边未点亮，供体验「点亮关联」功能）

import { db, uid, getSettings, saveSettings } from '../db'
import type { LearningLine, TreeNode, NodeState, ChecklistItem } from '../types'

export const DEMO_VERSION = 2

export interface DemoNodeSpec {
  name: string
  definition: string
  example: string
  whyImportant: string
  principle?: string
  pitfalls?: string[]
  state?: NodeState
  edgeWhy?: string
  edgeExamples?: string[]
  children?: DemoNodeSpec[]
}

const shortDivision: DemoNodeSpec = {
  name: '掌握短除法',
  definition: '短除法是一种快速分解质因数、求最大公因数和最小公倍数的竖式计算方法：用质数不断去除一个数，直到商为质数。',
  example: '把 36 分解：36 ÷ 2 = 18，18 ÷ 2 = 9，9 ÷ 3 = 3，得到 36 = 2 × 2 × 3 × 3。',
  whyImportant: '它是小学数论的核心工具，也是分数约分和初中因式分解的桥梁。',
  principle: '短除法能成立的原因：任何合数都能唯一地拆成质数相乘（算术基本定理），所以反复除以质数一定能拆到底。',
  state: 'learning',
  children: [
    {
      name: '除法基本概念',
      definition: '除法是求「一个数里包含几个另一个数」的运算，用 ÷ 表示；被除数是被分的总数，除数是每份多少，商是分出的份数。',
      example: '12 ÷ 3 = 4，表示 12 里面有 4 个 3。',
      whyImportant: '短除法的每一步都是一次除法，这是看懂一切的前提。',
      principle: '除法是乘法的逆运算——问「12 里有几个 3」，等价于问「3 乘几等于 12」。',
      state: 'mastered',
      edgeWhy: '短除法本质是一连串除法运算——每一步都在「除以一个数」。先把除法本身彻底弄懂，后面的符号和步骤才不会陌生。',
      edgeExamples: ['12 ÷ 3 = 4：12 个苹果平均分给 3 个人，每人得 4 个', '30 ÷ 6 = 5：30 页书每天读 6 页，正好 5 天读完'],
      children: [
        {
          name: '被除数、除数、商',
          definition: '被除数是「被分的总数」，除数是「每份多少」，商是「分出的份数」。',
          example: '12 ÷ 3 = 4 中，12 是被除数，3 是除数，4 是商。',
          whyImportant: '短除法中要能立刻说出每个数扮演的角色。',
          principle: '除法算式只是把「总数 = 每份 × 份数」这个乘法关系反过来写。',
          state: 'mastered'
        },
        {
          name: '余数',
          definition: '除不尽时剩下的数；余数一定比除数小。',
          example: '17 ÷ 5 = 3 余 2，2 就是余数。',
          whyImportant: '短除法每一步都要判断有没有余数——有余数说明这个数不是因数。',
          principle: '余数就是「分到分不动为止剩下的部分」；剩下的不够再分一份，所以它必然比除数小。',
          pitfalls: ['忘掉「余数必须比除数小」，检查时发现不了错误'],
          state: 'mastered'
        }
      ]
    },
    {
      name: '整除与因数',
      definition: '整除是指相除后余数为 0；如果 a 能被 b 整除，b 就是 a 的因数。',
      example: '12 能被 3 整除，所以 3 是 12 的因数。',
      whyImportant: '短除法本质是在不断找因数，最终找到质因数。',
      principle: '「除得尽」意味着总数能被除数正好分成整份，这时除数就是总数结构中的一块「积木」。',
      state: 'fuzzy',
      edgeWhy: '做除法时你会注意到：有的算式刚好除尽（余数为 0），有的除不尽——「除得尽」这件事值得专门研究，于是引出了整除与因数。',
      edgeExamples: ['12 ÷ 3 余 0，所以 3 是 12 的因数', '17 ÷ 5 余 2，除不尽，所以 5 不是 17 的因数'],
      children: [
        {
          name: '质数与合数',
          definition: '只有 1 和它本身两个因数的数是质数；因数多于两个的自然数是合数。',
          example: '7 是质数（因数只有 1 和 7），9 是合数（还有因数 3）。',
          whyImportant: '短除法停止的信号就是「商是质数」。',
          principle: '质数是不能再拆的「积木」，合数是可以继续拆的组合体——这是整座数论大厦的地基。',
          state: 'fuzzy'
        },
        {
          name: '质因数',
          definition: '一个数的因数中，本身是质数的那些数。',
          example: '12 = 2 × 2 × 3，2 和 3 都是 12 的质因数。',
          whyImportant: '短除法的最终目标就是把一个数写成质因数相乘。',
          principle: '一个数拆到底，剩下的积木一定都是质数（算术基本定理），这些积木就是它的质因数。',
          edgeWhy: '研究因数时你会发现因数还能再分：6 是 12 的因数，但 6 = 2 × 3 还能拆。拆到拆不动，剩下的就是质因数——这正是短除法要找的东西。',
          edgeExamples: ['12 = 2 × 2 × 3，其中 2 和 3 都是质因数', '30 = 2 × 3 × 5，三个都是质因数']
        }
      ]
    },
    {
      name: '竖式除法（长除法）',
      definition: '把除法过程竖着写下来的标准格式，能处理任意大小的数。',
      example: '用竖式计算 156 ÷ 12 = 13。',
      whyImportant: '短除法是长除法的精简版，先会长除法才能明白短除法省掉了什么。',
      principle: '竖式把除法拆成「一位一位地试商」的循环，本质是逐步逼近：每次求出商的一位，剩下的继续分。',
      state: 'learning',
      edgeWhy: '短除法是长除法的「精简版」——先看懂长除法完整的试商、乘、减过程，才能明白短除法省掉了哪些步骤、为什么更快。',
      edgeExamples: ['用竖式计算 156 ÷ 12 = 13，体会每一步：试商 → 乘 → 减 → 落下一位', '用竖式计算 84 ÷ 4 = 21，从一位除数开始'],
      children: [
        {
          name: '一位数除法竖式',
          definition: '除数只有一位的竖式除法。',
          example: '84 ÷ 4 = 21 的竖式过程。',
          whyImportant: '最简单的竖式，熟悉「试商-乘-减-落」循环。',
          principle: '除数为一位时，试商只需要乘法口诀——这是竖式循环最简单的版本。',
          state: 'mastered'
        },
        {
          name: '多位数除法竖式',
          definition: '除数是两位及以上的竖式除法。',
          example: '156 ÷ 12 = 13。',
          whyImportant: '熟悉大数除法后，短除法的简洁才有对比意义。',
          principle: '除数为多位时，试商要「估」：先看前几位够不够除，再用乘法验证调整。',
          state: 'learning'
        }
      ]
    },
    {
      name: '短除法的操作步骤',
      definition: '短除法三步：从最小的质数开始试除 → 把商写在被除数下方 → 重复直到商是质数。',
      example: '30 ÷ 2 = 15，15 ÷ 3 = 5（5 是质数，停止），所以 30 = 2 × 3 × 5。',
      whyImportant: '这是本目标的直接核心，前面所有概念都汇聚到这三步。',
      principle: '短除法把长除法中「写出来但不改变结果」的步骤全省掉，只保留试除本身——因为除数都是质数，每一步要么除得尽，要么直接换下一个。',
      edgeWhy: '前面所有概念都汇聚到这里：现在把它们串成三步连贯动作，这就是短除法本身。',
      edgeExamples: ['把 30 分解：30 ÷ 2 = 15，15 ÷ 3 = 5，5 是质数，停止', '把 36 分解：36 ÷ 2 = 18，18 ÷ 2 = 9，9 ÷ 3 = 3，得到 36 = 2×2×3×3'],
      children: [
        {
          name: '从最小的质数开始试除',
          definition: '分解时先试 2，除不尽再试 3、5、7……按质数从小到大的顺序。',
          example: '45 不能被 2 整除（45 ÷ 2 余 1），试 3：45 ÷ 3 = 15，成功。',
          whyImportant: '从小到大试，保证不遗漏任何因数，步骤也最短。',
          principle: '质因数分解的结果唯一，但顺序不唯一；从最小质数开始试是「字典序最小」的约定，保证不重复不遗漏。',
          pitfalls: ['跳过 2 直接试 3，漏掉因数 2'],
          edgeWhy: '分解时你面临的第一个选择是「先除以几」。规则是从最小的质数 2 开始试——这是不遗漏因数、步骤最短的关键。',
          edgeExamples: ['45 不能被 2 整除，试 3：45 ÷ 3 = 15，成功', '56 能被 2 整除：56 ÷ 2 = 28，继续 ÷ 2 = 14']
        },
        {
          name: '除到商为质数为止',
          definition: '停止条件是最后的商是质数，无法继续分解。',
          example: '15 ÷ 3 = 5，5 是质数，停止。',
          whyImportant: '这就是「分解到最细」的意思。',
          principle: '质数不能再分，所以商变质数就意味着「拆到了底」——这是唯一确定的停止条件。',
          pitfalls: ['把 1 当成质数继续除，永远停不下来'],
          edgeWhy: '试除不能无限进行下去。「商是质数」就是停止信号——质数不能再分解，说明你已经分解到底了。',
          edgeExamples: ['15 ÷ 3 = 5，5 是质数，停止：15 = 3 × 5', '28 ÷ 2 = 14，14 ÷ 2 = 7，7 是质数，停止：28 = 2 × 2 × 7']
        }
      ]
    },
    {
      name: '短除法的应用',
      definition: '短除法用于求最大公因数、最小公倍数和分数约分。',
      example: '用短除法求 18 和 24 的最大公因数是 6。',
      whyImportant: '学以致用，应用场景反过来巩固操作。',
      principle: '短除法输出的是质因数分解，而公因数、公倍数、约分都能从「两个数各自的质因数」里直接读出来。',
      edgeWhy: '学会操作只是第一步，真正掌握要看你会不会用它解决问题——求公因数、公倍数、约分，都是短除法的主场。',
      edgeExamples: ['用短除法求 18 和 24 的最大公因数', '把分数 18/24 约成最简分数 3/4'],
      children: [
        {
          name: '求最大公因数',
          definition: '两个数共有的因数中最大的一个。',
          example: '18 和 24 的公因数有 1、2、3、6，最大的是 6。',
          whyImportant: '分数约分和化简比都要用它。',
          principle: '两个数共有的因数，一定是它们共有质因数的组合；最大公因数就是把共同的质因数全部乘起来。',
          pitfalls: ['只乘了部分共有质因数，漏乘'],
          edgeWhy: '短除法最常见的使用场景：两个数并排短除，把左边共用的质因数乘起来就是最大公因数——约分和化简全靠它。',
          edgeExamples: ['18 和 24 并排短除：都除以 2 得 9 和 12，再除以 3 得 3 和 4；最大公因数 = 2 × 3 = 6', '12 和 20 并排短除：都除以 2 得 6 和 10，再除以 2 得 3 和 5；最大公因数 = 2 × 2 = 4']
        },
        {
          name: '分数约分',
          definition: '把分数分子分母同除以公因数，化成最简分数。',
          example: '18/24 分子分母同除以 6，得到 3/4。',
          whyImportant: '短除法最常见的日常应用。',
          principle: '分数值不变的关键是「分子分母同乘同除一个数，分数大小不变」——约分就是同时除以最大公因数。',
          pitfalls: ['没约到最简就停（分子分母还有公因数）']
        }
      ]
    }
  ]
}

const economics: DemoNodeSpec = {
  name: '看懂基础经济新闻',
  definition: '理解新闻里常见经济术语的含义与背后逻辑，能读懂一条宏观新闻在说什么。',
  example: '读到「央行降息 25 个基点」时，能说出它对房贷和股市的大致影响。',
  whyImportant: '经济新闻影响每个人的钱袋子，也是很多领域的基础背景知识。',
  principle: '宏观经济的本质是「钱与货的流动」：总量、价格、利率、汇率都在描述这种流动的快慢和方向。',
  state: 'learning',
  children: [
    {
      name: 'GDP（国内生产总值）',
      definition: '一个国家或地区一段时间内生产的全部最终商品与服务的市场价值总和。',
      example: '「2024 年中国 GDP 增长 5%」意思是经济总量比去年多了 5%。',
      whyImportant: '衡量经济大小的头号指标，新闻里出现频率最高。',
      principle: '把一年内所有「新生产的东西」按市场价加总就是经济总规模——只算最终品、不算转卖，避免重复计算。',
      edgeWhy: '经济新闻里几乎每条都提到 GDP——它是描述一个国家经济总量的头号数字，先认识它，新闻里的「增长」「放缓」才有着落。',
      edgeExamples: ['「2024 年中国 GDP 增长 5%」——经济总量比去年多了 5%', '「美国一季度 GDP 环比下降」——经济正在收缩的信号']
    },
    {
      name: 'CPI 与通货膨胀',
      definition: 'CPI 衡量一篮子消费品价格的涨跌；物价普遍持续上涨叫通货膨胀。',
      example: 'CPI 同比上涨 2%，意味着同样的钱能买的东西变少了。',
      whyImportant: '通胀高低直接决定央行加息还是降息。',
      principle: '物价普遍上涨的根源通常是「钱变多了而东西没变多」，一篮子商品的价格变化能捕捉这个趋势。',
      edgeWhy: '看懂 GDP 后你马上会问：东西变贵了吗？CPI 就是回答「物价涨了多少」的指标，而持续的物价上涨就是通货膨胀。',
      edgeExamples: ['「CPI 同比上涨 2%」：去年 100 元能买的一篮子东西，今年要 102 元', '猪肉涨价 30% 会明显推高 CPI，因为食品在 CPI 里权重很大']
    },
    {
      name: '利率',
      definition: '借钱的成本，通常指央行公布的基准利率。',
      example: '利率从 3% 降到 2.5%，房贷月供会减少。',
      whyImportant: '央行通过利率调节整个经济的冷热。',
      principle: '利率是钱的「租金」：借钱要付租金、存钱能收租金，央行通过调租金控制大家借钱花钱的意愿。'
    },
    {
      name: '股市与指数',
      definition: '股票是公司所有权的凭证；指数（如上证指数）反映一组股票的整体价格走势。',
      example: '「沪指涨 1.2%」表示上海股市整体上涨。',
      whyImportant: '经济新闻常把股市当作经济信心的温度计。',
      principle: '股价反映市场对公司未来赚钱能力的预期；指数把一篮子股票打包，用来衡量整体预期。'
    },
    {
      name: '汇率',
      definition: '两种货币之间的兑换比率。',
      example: '1 美元 = 7.2 元人民币，涨到 7.3 表示人民币贬值。',
      whyImportant: '进出口、旅游、留学成本都受汇率影响。',
      principle: '汇率由两种货币的供求决定：一个国家出口强、利率高、大家都想要它的货币，它的货币就升值。'
    },
    {
      name: '失业率',
      definition: '失业人口占劳动人口的比例。',
      example: '失业率 5% 意味着每 100 个劳动力中约 5 人没有工作。',
      whyImportant: '就业好坏是政府政策的核心目标之一。',
      principle: '失业率是「想工作却找不到工作的人」的比例，它和经济增长互相影响：经济差时企业少招人，失业率上升。'
    }
  ]
}

const swimming: DemoNodeSpec = {
  name: '自由泳入门',
  definition: '学会自由泳的基础：换气、打腿、划手与身体姿态，能连续游 25 米。',
  example: '完成 25 米自由泳，全程呼吸顺畅、不呛水。',
  whyImportant: '自由泳是效率最高的泳姿，也是铁人三项的基础。',
  principle: '自由泳的核心矛盾是「推进力与阻力」：划手打腿产生推进，身体姿态减少阻力，呼吸让能量持续供应。',
  state: 'learning',
  children: [
    {
      name: '呼吸与换气',
      definition: '自由泳的呼吸节奏：头埋在水中呼气，转头时吸气。',
      example: '划 3 次手换一次气，转头时嘴露出水面快速吸气。',
      whyImportant: '不会换气就永远游不远，这是初学者的第一道坎。',
      principle: '游泳呼吸的难点在于「头大部分时间在水里」，所以必须把呼气藏在水下，只在转头瞬间吸气。',
      children: [
        {
          name: '水中呼气',
          definition: '头埋在水中时，用鼻子持续、缓慢地把气吐完。',
          example: '脸朝下漂浮时「咕噜咕噜」匀速吐泡泡，直到转头前吐完。',
          whyImportant: '不吐气就没法吸气，呛水大多是因为憋气。'
        },
        {
          name: '转头换气时机',
          definition: '在划手推水的后半程转头，嘴刚好出水时吸气。',
          example: '右手推水到大腿时，头向右转，左耳仍贴水面，吸气后快速回正。',
          whyImportant: '时机错了会喝水，时机对了换气毫不费力。'
        }
      ]
    },
    {
      name: '打腿',
      definition: '双腿上下交替打水，提供身体平衡和部分推进力。',
      example: '手扶池边打腿，水花连续但不大，身体不下沉。',
      whyImportant: '打腿是身体水平的基础，腿沉了全身都沉。',
      principle: '打腿的第一任务是保持身体水平——腿沉下去，阻力会成倍增加，划手再强也白费。',
      children: [
        {
          name: '鞭状打腿',
          definition: '大腿带动小腿上下摆动，像鞭子一样从髋部发力，脚背绷直。',
          example: '想象用脚尖轻轻踢水，膝盖微屈，幅度 20~30 厘米。',
          whyImportant: '只弯膝盖打腿又累又慢，髋部发力才省力高效。'
        },
        {
          name: '打腿与身体的配合',
          definition: '打腿节奏与划手、转体协调，保持身体流线。',
          example: '划一次手打 6 次腿，身体随划手左右滚动。',
          whyImportant: '手脚打架会互相抵消，配合好才能游得直。'
        }
      ]
    },
    {
      name: '划手',
      definition: '手臂在水下划水产生主要推进力：入水、抱水、推水、移臂。',
      example: '手掌入水后向前伸展，肘部抬高抓住水，向后推到腿边再出水。',
      whyImportant: '自由泳 80% 以上的推进力来自划手。',
      principle: '划手要「抓住静水」往后推：手掌相对水向后移动得越快越稳，身体获得的向前反作用力就越大。',
      children: [
        {
          name: '高肘抱水',
          definition: '入水后保持肘高于手，用前臂和手掌「抓住」水。',
          example: '想象抱一个大水球，肘部始终比手腕高。',
          whyImportant: '肘掉下去就抓不住水，划空是初学者最常见的错误。'
        },
        {
          name: '推水与移臂',
          definition: '手从胸前加速推到大腿旁，然后肘部先出水、放松移臂回到前方。',
          example: '推水像把水往后扔，移臂时手指几乎擦着水面划过。',
          whyImportant: '推水决定速度，放松的移臂决定你能不能游得久。'
        }
      ]
    },
    {
      name: '身体姿态',
      definition: '身体水平、收紧、像一根浮木一样在水中滑行。',
      example: '蹬壁滑行时身体呈一条直线，不塌腰、不抬头。',
      whyImportant: '身体姿态是速度的基础，姿态好阻力小一半。',
      principle: '水的阻力比空气大约 800 倍，所以减小身体截面、保持流线型比加大力气更划算。',
      children: [
        {
          name: '流线型漂浮',
          definition: '双臂夹紧头部，身体伸直平浮于水面的姿势。',
          example: '蹬壁后双手重叠夹耳，身体完全伸展开滑行 3~5 米。',
          whyImportant: '所有泳姿的出发和转身都用流线型。'
        },
        {
          name: '核心收紧与转体',
          definition: '腹部收紧，身体随划手绕纵轴左右转动约 30~45 度。',
          example: '像烤串一样绕身体的纵轴转动，而不是扭腰。',
          whyImportant: '转体让划手更长、换气更轻松。'
        }
      ]
    }
  ]
}

// ---------- 模板生成器（演示模式下新建任意学习线） ----------

export function demoChatQuestion(title: string, round: number): string {
  const qs = [
    '好的，先认识一下你。你为什么想学「' + title + '」？（比如：考试需要、工作需要、还是纯粹感兴趣？）',
    '你最近一次接触「' + title + '」是什么时候？当时学到了什么程度？',
    '你希望大概用多久掌握它？每周大约能投入多少时间？（不用精确，说个大概就行）'
  ]
  return qs[Math.min(round, qs.length - 1)]
}

export function demoChecklist(title: string): ChecklistItem[] {
  const names = [
    '「' + title + '」中的基础术语与概念',
    '「' + title + '」的入门工具或方法',
    '「' + title + '」的一个简单上手练习',
    '识别「' + title + '」中的常见误区',
    '与「' + title + '」相关的更基础的知识（数学/逻辑/常识）',
    '「' + title + '」的典型应用场景',
    '「' + title + '」领域的基本发展脉络',
    '能向别人解释「' + title + '」是什么'
  ]
  return names.map((n) => ({ id: uid(), name: n, state: 'unknown' as const }))
}

/** 演示模式的知识树模板：4 层深，展示「越详细越好」的分支结构 */
export function demoTreeSpec(title: string, reason: string): DemoNodeSpec {
  const leaf = (
    name: string,
    definition: string,
    example: string,
    whyImportant: string,
    principle: string
  ): DemoNodeSpec => ({ name, definition, example, whyImportant, principle })

  return {
    name: title,
    definition: title + '：本次学习目标。演示模式下生成的是 4 层通用骨架，配置 API Key 后 AI 会按你的摸底结果生成更深的个性化知识树。',
    example: '学完「' + title + '」后，你能独立完成一件相关的小任务（例：向别人讲清楚、动手做一遍）。',
    whyImportant: reason || '这是你为自己定下的学习目标。',
    principle: '把「' + title + '」拆到每个叶子都能在几分钟内看懂，这是知识树分解的通用思路（演示模式）。',
    state: 'learning',
    children: [
      {
        name: '「' + title + '」的基本概念',
        definition: '围绕「' + title + '」最常用的术语、组成部分与基本原理。',
        example: '找出「' + title + '」领域的 3 个高频术语并用自己的话解释。',
        whyImportant: '概念是地基，术语不通后面寸步难行。',
        principle: '学任何领域都从名词开始：术语和结构决定你能否听懂别人在说什么。',
        children: [
          {
            name: '关键术语',
            definition: '该领域出现频率最高的名词及其含义。',
            example: '建立自己的术语对照表，每个术语配一个例子。',
            whyImportant: '看得懂术语，才读得懂资料。',
            principle: '术语是领域的「语言」，先把高频词汇的意思钉牢，后面才读得懂资料。',
            children: [
              leaf('入门术语', '最先遇到、使用最频繁的基础词汇。', '用一句话解释该领域最重要的 3 个词。', '它是读懂任何资料的第一道门槛。', '入门术语通常「望文生义」就能懂一半，另一半靠例子补齐。'),
              leaf('进阶术语', '深入后才出现、含义更精确的专业词汇。', '把进阶术语翻译成大白话讲给外行听。', '能区分术语的精确含义，说明真懂了。', '进阶术语大多是对入门概念的精细化，学的时候先找它和哪个入门词有关。')
            ]
          },
          {
            name: '组成部分',
            definition: '这个领域由哪几个部分构成，各部分如何协作。',
            example: '画一张「整体-部分」结构图。',
            whyImportant: '先看全貌，再钻细节。',
            principle: '把整体拆成部件，是理解任何系统的基本方法。',
            children: [
              leaf('核心部件', '缺了它就运转不了的部分。', '去掉某部分，观察系统还转不转。', '分清主次，精力才花在刀刃上。', '核心部件是系统的「发动机」，其余部分都为它服务。'),
              leaf('辅助部件', '让核心部件更好用的支撑部分。', '找出 2 个锦上添花的辅助部分。', '先保证核心，再谈优化。', '辅助部件单独看意义不大，价值体现在和核心配合时。')
            ]
          },
          {
            name: '基本原理',
            definition: '这个领域「为什么这样运作」的底层逻辑。',
            example: '用一句话说出这个领域最核心的一条原理。',
            whyImportant: '弄懂原理，记不住细节也能推出来。',
            principle: '弄清「为什么这样设计」，比背下「是什么」记得更牢。',
            children: [
              leaf('它为什么有效', '这个领域的方法/工具为什么能起作用。', '给一个方法找出它背后的原理。', '知其然更知其所以然，才能举一反三。', '任何有效的方法都满足某个底层约束，找到约束就找到了原理。'),
              leaf('它的适用边界', '在什么情况下这套知识不适用。', '找一个反例：哪里用不上这套知识。', '知道边界，才不会被知识反咬一口。', '每个模型都有假设前提，前提不成立时结论就失效。')
            ]
          }
        ]
      },
      {
        name: '「' + title + '」的核心方法',
        definition: '完成「' + title + '」最常用、最有效的做法与流程。',
        example: '跟着教程完整走一遍标准流程，记录卡住的步骤。',
        whyImportant: '方法是把概念变成能力的通道。',
        principle: '概念只有变成可操作的步骤，才真正属于你。',
        children: [
          {
            name: '标准流程',
            definition: '动手前先看清从头到尾的完整步骤。',
            example: '把流程写成一张 5 步以内的清单。',
            whyImportant: '心中有流程，动手不慌张。',
            principle: '先走通完整流程，再谈优化。',
            children: [
              leaf('第一步：准备', '动手前需要准备的材料、环境与心态。', '开工前把清单逐项打勾。', '准备十分钟，省下两小时返工。', '准备阶段解决的是「巧妇难为无米之炊」的问题。'),
              leaf('第二步：执行', '按流程完整走一遍，不追求完美。', '第一次只求「跑通」，记录卡点。', '先完成再完美。', '执行中的卡点就是下一步要重点分解练习的地方。')
            ]
          },
          {
            name: '拆解练习',
            definition: '把流程拆成小段，逐段练习到熟练。',
            example: '每段独立练 3 次，再连起来做一遍。',
            whyImportant: '整体做不好时，问题一定藏在某一段里。',
            principle: '整体做不好时，问题一定藏在某一段里。',
            children: [
              leaf('分段练习', '把整体切成最小可练单元，逐个击破。', '找到最卡的那一段，单独练 5 遍。', '集中火力打薄弱环节，进步最快。', '分段练习把「大问题」降维成「小问题」，小问题都能解决。'),
              leaf('组合练习', '把熟练的小段连起来，还原完整流程。', '两段两段拼接，直到整条流程流畅。', '分段会了不代表整体会，拼接才是考验。', '组合时的新问题往往出在「段与段的衔接处」。')
            ]
          }
        ]
      },
      {
        name: '「' + title + '」的常见误区',
        definition: '初学者在「' + title + '」上最容易犯的错误与误解。',
        example: '收集 3 个自己或别人犯过的典型错误。',
        whyImportant: '避开误区，等于抄了近路。',
        principle: '提前知道坑在哪里，等于少走一半弯路。',
        children: [
          {
            name: '误区一：急于求成',
            definition: '跳过基础直接挑战高难度，结果反复受挫。',
            example: '基础练习没做熟就上完整任务，卡住后回头补课。',
            whyImportant: '承认基础的重要，才是最快的路径。',
            principle: '基础不牢时挑战高难度，只会反复受挫。',
            children: [
              leaf('典型表现', '怎么判断自己踩了这个坑。', '总想「一步到位」，练基础时心不在焉。', '识别症状，才能对症下药。', '急于求成的根源是把「看懂了」误当成「掌握了」。'),
              leaf('纠正方法', '怎么从这个坑里爬出来。', '给基础练习设一个明确的过关标准再进阶。', '按标准走，进步反而更快。', '把「会」的标准从「看懂」改成「能独立做对」。')
            ]
          },
          {
            name: '误区二：只学不练',
            definition: '看懂了就以为会了，从不动手。',
            example: '看完教程立刻合上资料，自己独立做一遍。',
            whyImportant: '复述和应用才是检验「真会」的标准。',
            principle: '「看懂」不等于「会做」，输出才是检验。',
            children: [
              leaf('典型表现', '怎么判断自己踩了这个坑。', '教程都懂，一合上就大脑空白。', '识别症状，才能对症下药。', '只输入不输出，知识永远停在「别人的话」层面。'),
              leaf('纠正方法', '怎么从这个坑里爬出来。', '学完立刻合上资料复述一遍，再动手做一遍。', '输出一次胜过输入十次。', '费曼学习法：能讲给别人听懂，才是真懂。')
            ]
          }
        ]
      },
      {
        name: '「' + title + '」的实际应用',
        definition: '把「' + title + '」用到真实场景中的机会与方式。',
        example: '找一个真实小任务，用「' + title + '」完成它。',
        whyImportant: '应用一次，胜过重读十遍。',
        principle: '应用一次胜过重读十遍。',
        children: [
          {
            name: '一个最小可行练习',
            definition: '最小、最快能完成的真实应用任务。',
            example: '今天就用所学解决一个真实小问题，哪怕很粗糙。',
            whyImportant: '尽早完成一次闭环，信心会翻倍。',
            principle: '尽早完成一次真实闭环，信心会翻倍。',
            children: [
              leaf('练习设计', '怎么设计一个「小但真实」的应用任务。', '把日常中的一件小事变成练习题。', '真实场景的练习才有迁移价值。', '好练习的三个标准：真实、有明确完成标准、30 分钟内可完成。'),
              leaf('完成标准', '怎么算「完成」、怎么算「合格」。', '给练习写下 1 条可检验的完成标准。', '没有标准，练习容易变成自我安慰。', '可检验的标准 = 第三人也能判断你是否做到。')
            ]
          }
        ]
      }
    ]
  }
}

/** 演示模式：把某个概念继续分解成更小的知识领域 */
export function demoDecompose(name: string): DemoNodeSpec[] {
  return [
    {
      name: name + '的核心原理',
      definition: '「' + name + '」背后最本质的一条原理：它为什么成立、为什么这样设计。',
      example: '用自己的话向一个外行解释「' + name + '」为什么是这样。',
      whyImportant: '原理是记忆的钩子，懂了原理细节可以自己推。',
      principle: '先弄清「它为什么成立」，比背定义记得牢十倍。'
    },
    {
      name: name + '的典型例子',
      definition: '最能代表「' + name + '」的具体实例集合。',
      example: '给「' + name + '」找 3 个不同场景的例子。',
      whyImportant: '概念只有挂在具体例子上，才不是空中楼阁。',
      principle: '例子是概念的「肉身」，例子越多理解越立体。'
    },
    {
      name: name + '的常见误区',
      definition: '学习「' + name + '」时最容易犯的错误与误解。',
      example: '收集一个自己或别人在「' + name + '」上犯过的错。',
      whyImportant: '知道别人在哪里摔跤，自己就能绕开。',
      principle: '误区是知识的「负样本」，正反对比理解才完整。'
    },
    {
      name: name + '的练习方法',
      definition: '检验和巩固「' + name + '」的最小练习方式。',
      example: '设计一个 10 分钟内能完成的「' + name + '」练习。',
      whyImportant: '亲手做一遍，才知道哪里没真懂。',
      principle: '输出是检验输入的唯一标准。'
    }
  ]
}

export function demoLightEdge(parentName: string, childName: string): { edgeWhy: string; edgeExamples: string[] } {
  return {
    edgeWhy: '在练习「' + parentName + '」时，你几乎每次都会碰到「' + childName + '」——「' + parentName + '」是整体，而「' + childName + '」决定了你能不能真正做对。',
    edgeExamples: [
      '例 1：做「' + parentName + '」的练习时，出现了一个必须用到「' + childName + '」才能解决的情况。',
      '例 2：把「' + parentName + '」讲给别人听时，被追问的第一个问题就落在「' + childName + '」上。'
    ]
  }
}

// ---------- 数据落地 ----------

function flattenSpec(
  spec: DemoNodeSpec,
  lineId: string,
  parentId: string | null
): { node: TreeNode; children: DemoNodeSpec[] } {
  const now = Date.now()
  const node: TreeNode = {
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
  return { node, children: spec.children ?? [] }
}

const DEMO_LINES: { title: string; reason: string; spec: DemoNodeSpec; category: 'expert' | 'hobby' | 'career' }[] = [
  {
    title: '看懂基础经济新闻',
    reason: '看财经新闻总是一知半解，想建立基础的宏观经济常识。',
    spec: economics,
    category: 'expert'
  },
  {
    title: '自由泳入门',
    reason: '夏天想去游泳，从零学会自由泳。',
    spec: swimming,
    category: 'hobby'
  },
  {
    title: '掌握短除法',
    reason: '孩子正在学分数约分，我想自己先弄明白短除法再教他。',
    spec: shortDivision,
    category: 'career'
  }
]

async function seedDemoData(): Promise<void> {
  const lines: LearningLine[] = DEMO_LINES.map((d, i) => ({
    id: uid(),
    title: d.title,
    reason: d.reason,
    category: d.category,
    createdAt: Date.now() - 86400000 * (i === 0 ? 0 : i === 1 ? 12 : 30),
    status: 'active'
  }))
  const nodes: TreeNode[] = []
  const queue: { spec: DemoNodeSpec; lineId: string; parentId: string | null }[] = []
  lines.forEach((l, i) => queue.push({ spec: DEMO_LINES[i].spec, lineId: l.id, parentId: null }))
  while (queue.length > 0) {
    const item = queue.shift()!
    const flat = flattenSpec(item.spec, item.lineId, item.parentId)
    nodes.push(flat.node)
    flat.children.forEach((c) => queue.push({ spec: c, lineId: item.lineId, parentId: flat.node.id }))
  }
  await db.transaction('rw', db.lines, db.nodes, async () => {
    await db.lines.bulkAdd(lines)
    await db.nodes.bulkAdd(nodes)
  })
  console.log('[demo] 已播种 3 条演示学习线，共', nodes.length, '个节点')
}

/**
 * 首次启动播种演示数据；演示数据升级（DEMO_VERSION）时，
 * 若用户尚未修改过演示线（标题仍与内置一致），则自动刷新为最新版。
 */
export async function ensureDemoSeed(): Promise<void> {
  const s = await getSettings()
  if (s.demoVersion >= DEMO_VERSION) return
  const lines = await db.lines.toArray()
  const demoTitles = DEMO_LINES.map((d) => d.title).sort()
  const isPureDemo = lines.length === 3 && lines.map((l) => l.title).sort().join('|') === demoTitles.join('|')
  if (lines.length === 0 || isPureDemo) {
    if (isPureDemo) {
      await db.transaction('rw', db.lines, db.nodes, db.onboarding, async () => {
        await db.lines.clear()
        await db.nodes.clear()
        await db.onboarding.clear()
      })
      console.log('[demo] 检测到旧版演示数据，正在刷新')
    }
    await seedDemoData()
  }
  await saveSettings({ demoVersion: DEMO_VERSION })
}
