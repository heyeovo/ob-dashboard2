import path from 'node:path'

// 协作者能读哪些目录，以及哪些文件一律不给读。
//
// 两件事分开：
//   目录是**配置**（每个协作者一份，存 Haven）—— 聊天的那个只看笔记，干活的那个看代码仓库
//   风险文件是**硬规则**（写死在这里）—— 不是配置项，没有开关，任何协作者都拦
//
// ⚠️ 第一版工具权限仍是只读（Read / Grep / Glob）。这里管的全是「能读到什么」。
// 第 5 步给写权限时，「能写哪些目录」要单独配，不能复用这份清单 ——
// 读的范围可以宽，写的范围必须窄。

/** dirs 没配时用哪些。就是仓库自己。 */
export function defaultDirs(): string[] {
  return [process.cwd()]
}

/**
 * 配置里的目录清单 → SDK 的 cwd + additionalDirectories。
 *
 * 空配置退回仓库根 —— 不是「什么都不能读」。真要收紧得靠下面的 denylist，
 * 不是靠给一个空目录列表（那样它连自己的代码都读不了，等于不能干活）。
 */
export function resolveDirs(dirs: string[] | undefined): {
  cwd: string
  additionalDirectories: string[]
} {
  const cleaned = (dirs || [])
    .map(d => String(d || '').trim())
    .filter(Boolean)
    // 相对路径按仓库根解析，免得配了个 ../x 落到意料之外的地方
    .map(d => path.resolve(process.cwd(), d))
  const unique = [...new Set(cleaned)]
  if (unique.length === 0) {
    const fallback = defaultDirs()
    return { cwd: fallback[0], additionalDirectories: fallback.slice(1) }
  }
  return { cwd: unique[0], additionalDirectories: unique.slice(1) }
}

/**
 * 一律不给读的文件。
 *
 * 判断标准是「有没有正当的读取需求」，不是「危不危险」——
 * 要它改代码不需要知道 key 长什么样；真要配环境变量，它该告诉你去哪一行改，
 * 而不是自己读出来。所以这里不留放行开关：
 * 读进上下文的那一刻内容就要发去中转站，事后撤不回来。
 *
 * 想临时给它看某个 .env，直接把那几行粘到对话里 —— 你主动给的，你知道给了什么。
 */
const DENY_PATTERNS: RegExp[] = [
  /(^|[\\/])\.env(\.|$)/i, // .env / .env.local / .env.production
  /\.(key|pem|pfx|p12|keystore|jks)$/i,
  /(^|[\\/])id_(rsa|dsa|ecdsa|ed25519)(\.|$)/i, // ssh 私钥（.pub 不在此列，见下）
  /(^|[\\/])credentials(\.json)?$/i,
  /(^|[\\/])\.npmrc$/i,
  /(^|[\\/])\.pypirc$/i,
  /(^|[\\/])\.git[\\/]config$/i, // 里面可能带 token 形式的 remote url
  /(^|[\\/])\.aws[\\/]/i,
  /(^|[\\/])\.ssh[\\/]/i,
  /(^|[\\/])service-account.*\.json$/i,
  /(^|[\\/])secrets?\.(json|ya?ml|toml)$/i,
]

/** 公钥无所谓，别把 id_rsa.pub 一起拦了 */
const ALLOW_PATTERNS: RegExp[] = [/\.pub$/i]

/** 这个路径是不是敏感文件。传什么都行（绝对/相对/带引号的都会先规整）。 */
export function isDeniedPath(target: string): boolean {
  const raw = String(target || '').trim().replace(/^["']|["']$/g, '')
  if (!raw) return false
  const normalized = raw.replace(/\//g, path.sep)
  if (ALLOW_PATTERNS.some(re => re.test(normalized))) return false
  return DENY_PATTERNS.some(re => re.test(normalized))
}

/**
 * 从工具入参里挑出「它想读哪个文件」。
 *
 *   Read → file_path（整个文件内容都会回去，这个必须拦住）
 *   Grep / Glob → path（搜哪个目录/文件）、glob（只搜哪些文件）
 *
 * ⚠️ 故意**不看** `pattern` —— 那是搜索用的正则，不是路径。
 * 拿它去比对会把正常操作也拦掉（比如在代码里搜 "credentials.json" 这个字符串）。
 *
 * ⚠️ 已知没堵死的口子：Grep 不带 glob、path 指向仓库根时，敏感文件也在搜索范围内，
 * 命中的**那几行**会回到上下文。要彻底堵得让引擎层给 Grep 强制加排除规则，
 * 那是第 5 步给写权限时一起做的事。Read 那条整文件的路径已经堵住了。
 */
export function pathsFromToolInput(input: unknown): string[] {
  if (!input || typeof input !== 'object') return []
  const obj = input as Record<string, unknown>
  const out: string[] = []
  for (const key of ['file_path', 'path', 'notebook_path', 'glob']) {
    const value = obj[key]
    if (typeof value === 'string' && value.trim()) out.push(value)
  }
  return out
}
