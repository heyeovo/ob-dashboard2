import path from 'node:path'

// 协作者能读哪些目录，以及哪些文件一律不给读。
//
// 两件事分开：
//   目录是**配置**（每个协作者一份，存 Haven）—— 聊天的那个只看笔记，干活的那个看代码仓库
//   风险文件是**硬规则**（写死在这里）—— 不是配置项，没有开关，任何协作者都拦
//
// 第 5 步起有写权限了，所以这里有**两份**目录清单，别搞混：
//   dirs        能读哪些（resolveDirs）—— 空 = 退回仓库根
//   write_dirs  能写哪些（resolveWriteDirs）—— 空 = 一个字都不许写
// 风险文件那道硬规则对读和写都生效。

/** dirs 没配时用哪些。就是仓库自己。 */
export function defaultDirs(): string[] {
  return [process.cwd()]
}

/**
 * 能**写**哪些目录（第 5 步）。跟上面那份读的清单故意不共用，规则也相反：
 *
 *   读：空 = 退回仓库根（不然它连自己的代码都看不了，等于不能干活）
 *   写：空 = 一个字都不许写
 *
 * 为什么反过来：读错了顶多浪费一次上下文，写错了是把文件改坏。
 * 所以第一次用写权限之前必须去协作者设置里明确加一行 —— 这个麻烦是故意的。
 */
export function resolveWriteDirs(dirs: string[] | undefined): string[] {
  return [
    ...new Set(
      (dirs || [])
        .map(d => String(d || '').trim())
        .filter(Boolean)
        .map(d => path.resolve(process.cwd(), d)),
    ),
  ]
}

/**
 * 这个路径在写清单里吗。
 *
 * 用 path.relative 判断包含关系，不用字符串前缀 —— 前缀比对会把
 * `C:\x\ob-dashboard2-backup` 当成 `C:\x\ob-dashboard2` 的子目录放过去。
 */
export function isWritablePath(target: string, writeDirs: string[]): boolean {
  const raw = String(target || '').trim().replace(/^["']|["']$/g, '')
  if (!raw) return false
  if (writeDirs.length === 0) return false
  const abs = path.resolve(process.cwd(), raw)
  return writeDirs.some(dir => {
    const rel = path.relative(dir, abs)
    return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
  })
}

/** 会改文件的工具。批准闸和写目录检查都按这张表来。 */
export const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit']

/** 会跑命令的工具。永远一条一条问，不进「本会话放行」那个开关。 */
export const EXEC_TOOLS = ['Bash', 'BashOutput', 'KillShell']

/**
 * 塞给 Grep 的排除规则（第 5 步，堵 4.5b 留的那个缺口）。
 *
 * 缺口是这样的：Read 整文件的路已经堵死了，但 Grep 不带 glob 直接扫仓库根时，
 * 密钥文件也在搜索范围内，**命中的那几行**会回到上下文。
 *
 * ripgrep 的 --glob 支持 ! 取反，SDK 的 Grep 就是透传 --glob，本地实测有效。
 * 所以在 PreToolUse 里把这条塞进 input.glob。
 *
 * ⚠️ 只有模型**没填 glob** 时塞得进去 —— Grep 只有一个 glob 参数，
 * 它自己填了正向 glob（`*.ts` 那种）我们没地方加。那种情况靠 PostToolUse
 * 把输出里的密钥文件行擦掉兜底（见 scrubDeniedLines）。
 */
export const GREP_EXCLUDE_GLOB =
  '!**/{.env,.env.*,*.key,*.pem,*.pfx,*.p12,*.keystore,*.jks,id_rsa*,id_dsa*,id_ecdsa*,id_ed25519*,credentials,credentials.json,.npmrc,.pypirc,service-account*.json,secret.json,secrets.json,secret.yaml,secrets.yaml,secret.yml,secrets.yml,secret.toml,secrets.toml}'

/**
 * Grep 结果里把密钥文件那几行擦掉（PostToolUse 兜底）。
 *
 * ripgrep 的输出每行都以 `路径:行号:内容` 开头，按行首那个路径判断就行。
 * 擦掉的行换成一句说明，让模型知道有东西被挡了、不要换个写法再试。
 */
export function scrubDeniedLines(output: string): { text: string; removed: number } {
  const lines = output.split('\n')
  let removed = 0
  const kept = lines.map(line => {
    // 行首那一段路径：Windows 盘符里的冒号要跳过，所以从第 3 个字符起找
    const head = line.slice(0, 3)
    const rest = line.slice(3)
    const colon = rest.indexOf(':')
    if (colon < 0) return line
    const candidate = head + rest.slice(0, colon)
    if (!isDeniedPath(candidate)) return line
    removed++
    return `${candidate}: [这个文件含密钥/凭据，内容被前端挡掉了。需要里面的值就直接问用户]`
  })
  if (removed === 0) return { text: output, removed: 0 }
  // 同一个文件被挡的行会重复出现同一句，去掉重复的
  const seen = new Set<string>()
  const deduped = kept.filter(line => {
    if (!line.includes('内容被前端挡掉了')) return true
    if (seen.has(line)) return false
    seen.add(line)
    return true
  })
  return { text: deduped.join('\n'), removed }
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
 * ⚠️ Grep 那个缺口第 5 步补了，两道一起上（见 GREP_EXCLUDE_GLOB / scrubDeniedLines）：
 *   没填 glob → PreToolUse 塞一条取反的排除 glob 进去
 *   填了 glob → 塞不进（只有一个参数），靠 PostToolUse 把命中行擦掉兜底
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
