import { lstat, realpath, stat } from 'node:fs/promises'
import path from 'node:path'

// 协作者能读哪些目录，以及哪些文件一律不给读。
//
// 两件事分开：
//   目录是**配置**（每个协作者一份，存 Haven）—— 聊天的那个只看笔记，干活的那个看代码仓库
//   风险文件是**硬规则**（写死在这里）—— 不是配置项，没有开关，任何协作者都拦
//
// 第 5 步起有写权限了，所以这里有**两份**目录清单，别搞混：
//   dirs        能读哪些（resolveDirs）—— 空 = 本机退回仓库根，production 退回 dashboard workspace
//   write_dirs  能写哪些（resolveWriteDirs）—— 空 = 一个字都不许写
// 风险文件那道硬规则对读和写都生效。

/** VPS production 允许挂进 Claude Code 的全部 workspace；不是 Persona 默认授权。 */
export const VPS_WORKSPACE_ROOTS = ['/workspace/dashboard', '/workspace/haven'] as const

type ResolveDirOptions = {
  cwd?: string
  production?: boolean
  /** 只给测试注入临时 Linux workspace；正式调用不能传。 */
  productionRoots?: readonly string[]
}

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

function cleanPath(target: string): string {
  return String(target || '').trim().replace(/^["']|["']$/g, '')
}

async function existingDirectory(target: string): Promise<string> {
  const resolved = await realpath(target)
  if (!(await stat(resolved)).isDirectory()) throw new Error(`不是目录：${target}`)
  return resolved
}

async function productionRoots(options: ResolveDirOptions): Promise<string[]> {
  const configured = options.productionRoots || VPS_WORKSPACE_ROOTS
  const roots: string[] = []
  for (const root of configured) {
    const lexical = path.resolve(root)
    const resolved = await existingDirectory(lexical)
    // production 的固定 mount point 自己也不能是跳到别处的 symlink。
    if (resolved !== lexical) throw new Error(`production workspace 根不是实际目录：${lexical}`)
    roots.push(resolved)
  }
  return roots
}

/**
 * 本机 dev 保留原来的 process.cwd() fallback；production 不把运行镜像 /app 当 workspace，
 * 未配置 Persona dirs 时只默认进入 /workspace/dashboard。
 */
export function defaultDirs(options: ResolveDirOptions = {}): string[] {
  const cwd = options.cwd || process.cwd()
  const production = options.production ?? process.env.NODE_ENV === 'production'
  if (!production) return [cwd]
  return [String((options.productionRoots || VPS_WORKSPACE_ROOTS)[0])]
}

async function resolveConfiguredDirs(
  dirs: string[] | undefined,
  options: ResolveDirOptions,
  fallback: boolean,
): Promise<string[]> {
  const cwd = options.cwd || process.cwd()
  const production = options.production ?? process.env.NODE_ENV === 'production'
  const raw = (dirs || []).map(cleanPath).filter(Boolean)
  const candidates = raw.length > 0 ? raw.map(dir => path.resolve(cwd, dir)) : fallback ? defaultDirs(options) : []
  const allowedRoots = production ? await productionRoots(options) : null
  const resolved: string[] = []

  for (const candidate of candidates) {
    const actual = await existingDirectory(candidate)
    if (allowedRoots && !allowedRoots.some(root => isInside(root, actual))) {
      throw new Error(
        `目录不在 VPS workspace 白名单内：${candidate}。只允许：${allowedRoots.join('、')}`,
      )
    }
    resolved.push(actual)
  }
  return [...new Set(resolved)]
}

/**
 * 能**写**哪些目录（第 5 步）。跟上面那份读的清单故意不共用，规则也相反：
 *
 *   读：空 = 退回默认工作区（本机仓库根；production 的 dashboard workspace）
 *   写：空 = 一个字都不许写
 *
 * 为什么反过来：读错了顶多浪费一次上下文，写错了是把文件改坏。
 * 所以第一次用写权限之前必须去协作者设置里明确加一行 —— 这个麻烦是故意的。
 */
export async function resolveWriteDirs(
  dirs: string[] | undefined,
  options: ResolveDirOptions = {},
): Promise<string[]> {
  return resolveConfiguredDirs(dirs, options, false)
}

/**
 * 这个路径在写清单里吗。
 *
 * 用 path.relative 判断包含关系，不用字符串前缀 —— 前缀比对会把
 * `C:\x\ob-dashboard2-backup` 当成 `C:\x\ob-dashboard2` 的子目录放过去。
 */
export async function isWritablePath(
  target: string,
  writeDirs: string[],
  cwd = process.cwd(),
): Promise<boolean> {
  return isPathWithinRoots(target, writeDirs, cwd)
}

/** 只读工具也必须留在本窗口 SDK 实际拿到的 cwd/additionalDirectories 内。 */
export async function isReadablePath(target: string, readDirs: string[], cwd: string): Promise<boolean> {
  return isPathWithinRoots(target, readDirs, cwd)
}

/**
 * 已存在目标校验自己的 realpath；新目标逐级向上寻找最近已存在父目录。
 * 遇到 dangling symlink 会拒绝，不能把它误当成普通的新文件。
 */
export async function isPathWithinRoots(
  target: string,
  roots: string[],
  cwd = process.cwd(),
): Promise<boolean> {
  const raw = cleanPath(target)
  if (!raw || roots.length === 0) return false
  const absolute = path.resolve(cwd, raw)
  if (!roots.some(root => isInside(root, absolute))) return false

  let probe = absolute
  while (true) {
    try {
      const actual = await realpath(probe)
      return roots.some(root => isInside(root, actual))
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT') return false
      try {
        // lstat 成功但 realpath ENOENT，说明这里是 dangling symlink。
        await lstat(probe)
        return false
      } catch (lstatError) {
        if ((lstatError as NodeJS.ErrnoException).code !== 'ENOENT') return false
      }
      const parent = path.dirname(probe)
      if (parent === probe) return false
      probe = parent
    }
  }
}

/** 会改文件的工具。批准闸和写目录检查都按这张表来。 */
export const WRITE_TOOLS = ['Write', 'Edit', 'NotebookEdit']

/** 有文件系统路径入参的只读工具。 */
export const READ_PATH_TOOLS = ['Read', 'Grep', 'Glob']

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
 * 空配置退回默认工作区 —— 不是「什么都不能读」。真要收紧得靠下面的 denylist，
 * 不是靠给一个空目录列表（那样它连自己的代码都读不了，等于不能干活）。
 */
export async function resolveDirs(
  dirs: string[] | undefined,
  options: ResolveDirOptions = {},
): Promise<{
  cwd: string
  additionalDirectories: string[]
}> {
  const unique = await resolveConfiguredDirs(dirs, options, true)
  if (unique.length === 0) {
    const fallback = await resolveConfiguredDirs(undefined, options, true)
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

/**
 * 取出 SDK 内建文件工具真正用于访问文件系统的路径。
 * Grep / Glob 没有传 path 时会从 SDK cwd 开始，glob 是匹配式而不是目录。
 */
export function pathTargetFromToolInput(
  toolName: string,
  input: unknown,
  cwd: string,
): string | null {
  if (!input || typeof input !== 'object') return null
  const obj = input as Record<string, unknown>
  if (toolName === 'NotebookEdit') return cleanPath(String(obj.notebook_path || '')) || null
  if (toolName === 'Read' || toolName === 'Write' || toolName === 'Edit') {
    return cleanPath(String(obj.file_path || '')) || null
  }
  if (toolName === 'Grep' || toolName === 'Glob') {
    return cleanPath(String(obj.path || '')) || cwd
  }
  return null
}
