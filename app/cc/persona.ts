// 协作者（4.5b）。配置存在 Haven 的 cc_personas 表里，通过 /api/cc-personas 读写。
//
// ⚠️ 为什么不存浏览器：localStorage 按设备 + 按浏览器各存一份 = 复刻 Polaris
// 那个「手机和 PC 两份数据」的坑。存 Haven 之后所有入口读同一份。
//
// 界面上的分工（照 Polaris，三个位置别混）：
//   对话列表左上角 → 切换协作者（本文件的列表）
//   对话列表右上角 → 当前这个协作者的设置（身份 / 提示词 / 记忆 / 引擎）
//
// 提示词模块按协作者保存默认状态；每个窗口可另存启停覆盖。ccSession.ts 会在最终
// system 内容变化时安全回收空闲子进程，下一轮用原 Claude 会话 resume 后生效。

import {
  DEFAULT_PERSONA_BASE_PROMPT,
  LEGACY_SELFHOST_BASE_PROMPT,
} from '@/app/lib/personaPrompt'

/** 引擎 = 额度 + 请求拼装归谁。selfhost 是第 7 步的自建引擎，界面里灰着。 */
export type CcEngine = 'subscription' | 'api' | 'selfhost'

export type CcPromptModule = {
  id: string
  name: string
  content: string
  enabledByDefault: boolean
}

export type CcPersona = {
  id: string
  /** 显示名 */
  name: string
  /** 没有头像图时显示的字 */
  initial: string
  /** 头像底色 */
  tint: string
  /** 你希望 TA 怎么称呼你 */
  userName: string
  /** TA 如何理解自己在这里的位置 */
  purpose: string
  /** 一句话印象，只在协作者列表里显示 */
  description: string
  /** 每个协作者自己的基础 system 提示词；允许明确保存为空 */
  basePrompt: string
  /** 可独立维护的 systemPrompt 模块；窗口可覆盖每个模块的默认启停 */
  promptModules: CcPromptModule[]
  /** 手写的记忆条目，跟提示词一起 append（分开存是为了改一条不用动整段） */
  memoryEntries: string[]
  /** 关掉就不查 OB 记忆 */
  recallOn: boolean
  /** 关掉只做关键词匹配，不跑向量检索（快，但召回少） */
  semanticOn: boolean
  /**
   * 能读哪些目录。第一个当工作目录，其余作附加目录。空 = 只有仓库本身。
   * ⚠️ 密钥类文件（.env / *.key / id_rsa 等）跟这份清单无关，服务端一律硬拦，
   * 见 app/lib/ccDirs.ts。这里配的只是「看得到多大范围」。
   */
  dirs: string[]
  /**
   * 能**写**哪些目录。跟上面那份规则相反：**空 = 一个文件都不许改**。
   *
   * 为什么分两份：看错了只是浪费钱，写错了会把文件改坏。读可以给宽（要理解上下文），
   * 写必须给窄（只在你真的在做的那个项目里）。
   * ⚠️ 就算某个目录在这份清单里，每次改文件仍然要点批准 —— 这份清单管的是
   *「哪些地方**可以**被批准」，不是「不用问了」。
   */
  writeDirs: string[]
  engine: CcEngine
}

/** Haven 读不到时用的兜底 —— 不能让聊天页因为配置拿不到就白屏。 */
export const FALLBACK_PERSONA: CcPersona = {
  id: 'ombre',
  name: 'Ombre',
  initial: 'O',
  tint: 'var(--chat-avatar-tint)',
  userName: '',
  purpose: '',
  description: '',
  basePrompt: DEFAULT_PERSONA_BASE_PROMPT,
  promptModules: [],
  memoryEntries: [],
  recallOn: true,
  semanticOn: true,
  dirs: [],
  writeDirs: [],
  engine: 'api',
}

/** Haven 的 snake_case 一行 → 界面用的驼峰对象 */
export function personaFromHaven(row: Record<string, unknown>): CcPersona {
  const engine = String(row.engine || 'api')
  const entries = Array.isArray(row.memory_entries) ? row.memory_entries : []
  const dirs = Array.isArray(row.dirs) ? row.dirs : []
  const writeDirs = Array.isArray(row.write_dirs) ? row.write_dirs : []
  const rawModules = Array.isArray(row.prompt_modules) ? row.prompt_modules : []
  const promptModules = rawModules.flatMap((item, index): CcPromptModule[] => {
    if (!item || typeof item !== 'object') return []
    const value = item as Record<string, unknown>
    const content = String(value.content || '').trim()
    if (!content) return []
    return [{
      id: String(value.id || `module-${index + 1}`).trim() || `module-${index + 1}`,
      name: String(value.name || '未命名模块').trim() || '未命名模块',
      content,
      enabledByDefault: value.enabled_by_default !== false,
    }]
  })
  const legacyPrompt = String(row.prompt || '').trim()
  if (promptModules.length === 0 && legacyPrompt) {
    promptModules.push({
      id: 'legacy-prompt',
      name: '协作者提示词',
      content: legacyPrompt,
      enabledByDefault: true,
    })
  }
  return {
    id: String(row.id || ''),
    name: String(row.name || '') || '未命名',
    initial: String(row.initial || '') || String(row.name || 'A').slice(0, 1).toUpperCase(),
    tint: String(row.tint || '') || FALLBACK_PERSONA.tint,
    userName: String(row.user_name || ''),
    purpose: String(row.purpose || ''),
    description: String(row.description || ''),
    basePrompt: row.base_prompt === undefined || row.base_prompt === null
      ? DEFAULT_PERSONA_BASE_PROMPT
      : String(row.base_prompt) === LEGACY_SELFHOST_BASE_PROMPT
        ? DEFAULT_PERSONA_BASE_PROMPT
        : String(row.base_prompt),
    promptModules,
    memoryEntries: entries.map(item => String(item ?? '')).filter(Boolean),
    recallOn: row.recall_on !== false,
    semanticOn: row.semantic_on !== false,
    dirs: dirs.map(item => String(item ?? '').trim()).filter(Boolean),
    writeDirs: writeDirs.map(item => String(item ?? '').trim()).filter(Boolean),
    engine: engine === 'subscription' || engine === 'selfhost' ? engine : 'api',
  }
}

/** 界面驼峰 → 提交给 /api/cc-personas 的 snake_case */
export function personaToPayload(persona: CcPersona): Record<string, unknown> {
  return {
    id: persona.id,
    name: persona.name,
    initial: persona.initial,
    tint: persona.tint,
    user_name: persona.userName,
    purpose: persona.purpose,
    description: persona.description,
    base_prompt: persona.basePrompt,
    // 兼容尚未部署 prompt_modules 的旧 Haven：模块仍是新事实源，同时镜像一份合并正文。
    // 删除全部模块时这里自然为空，也不会被旧字段恢复。
    prompt: persona.promptModules.map(module => module.content.trim()).filter(Boolean).join('\n\n'),
    prompt_modules: persona.promptModules.map(module => ({
      id: module.id,
      name: module.name,
      content: module.content,
      enabled_by_default: module.enabledByDefault,
    })),
    memory_entries: persona.memoryEntries,
    recall_on: persona.recallOn,
    semantic_on: persona.semanticOn,
    dirs: persona.dirs,
    write_dirs: persona.writeDirs,
    engine: persona.engine,
  }
}

/** 头像底色预设。跟 :root 里的 --chat-avatar-tint 同一个调子，别写死单色。 */
export const TINT_PRESETS: { id: string; label: string; value: string }[] = [
  { id: 'ombre', label: '橙', value: 'var(--chat-avatar-tint)' },
  { id: 'slate', label: '灰蓝', value: 'linear-gradient(150deg, #9AA7B8, #6E7C90)' },
  { id: 'moss', label: '苔绿', value: 'linear-gradient(150deg, #A3B892, #7A9166)' },
  { id: 'plum', label: '梅', value: 'linear-gradient(150deg, #C296A8, #9C6B80)' },
  { id: 'sand', label: '沙', value: 'linear-gradient(150deg, #DCC7A8, #BFA07A)' },
  { id: 'ink', label: '墨', value: 'linear-gradient(150deg, #6F6A66, #454240)' },
]

export const ENGINE_OPTIONS: {
  id: CcEngine
  label: string
  hint: string
  disabled?: boolean
}[] = [
  {
    id: 'subscription',
    label: 'Claude Code · 订阅额度',
    hint: '用本机 claude 的登录态。还没买会员时选它会报没凭据',
  },
  {
    id: 'api',
    label: 'Claude Code · 中转站',
    hint: '走 .env.local 里的 ANTHROPIC_BASE_URL / TOKEN。现在默认这条',
  },
  {
    id: 'selfhost',
    label: '自建引擎 · 中转站',
    hint: '只聊天、provider 可配。第 7 步做',
    disabled: true,
  },
]

/** 新建协作者时的初值 */
export function draftPersona(): CcPersona {
  const rand = Math.random().toString(36).slice(2, 8)
  return {
    ...FALLBACK_PERSONA,
    id: `p-${Date.now().toString(36)}-${rand}`,
    name: '新协作者',
    initial: 'A',
    tint: TINT_PRESETS[1].value,
  }
}
