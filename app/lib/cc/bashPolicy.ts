// CC 工作模式的命令放行规则（2026-10-09，Todo 91f841dd / bd5afb52）。
//
// 批准机制反过来：默认全放行，只有「永远要问」清单里的才弹卡。
// 小羊原话：批准卡她都通通点、等于没有 —— 卡越少，剩下的每张才越有分量。
//
// 「永远要问」（前台弹卡，后台 wake / 房间里直接拒）：
//   - push main / 强推 / 删远端分支 / 不写目标分支的 push（可能推到 main 触发部署）
//   - git reset --hard、git clean -f（丢未提交改动）
//   - 删 workspace 外的文件、删整个仓库根、删 /data（Haven 数据卷在那边）
//   - 碰凭据（.env、.git-credentials、Claude / Codex 登录文件、printenv）
//   - 发 DELETE 请求、杀进程组（pkill / killall 会把 dashboard 自己杀掉）、curl | sh
//
// 后台 wake 额外一层：主仓库检出（/workspace/dashboard、/workspace/haven）是前台
// 工作窗口在用的工作区，后台只读不写；写文件、提交都只能在 WORKTREE_ROOT 下的
// worktree 分支里，可以 push 那个分支（不部署），不能动 main。
//
// ⚠️ 这是防手滑的护栏，不是沙箱：按词法拆命令，`python x.py` 里写了什么看不见。
// 判断不了的（变量、命令替换做路径）一律当危险处理。

import path from 'node:path'
import { isDeniedPath } from '@/app/lib/ccDirs'
import { MAIN_CHECKOUTS, WORKTREE_ROOT } from '@/app/lib/cc/worktree'

export type BashVerdict = { level: 'allow' | 'ask' | 'deny'; reason: string }

export type BashPolicyContext = {
  /** SDK 会话 cwd（命令没 cd 时在这里跑）。 */
  cwd: string
  /** 允许写的目录（协作者配置 + 内置）。workspace 外 = 不在这些目录里。 */
  writeDirs: string[]
  background: boolean
  /** 只给测试注入。 */
  worktreeRoot?: string
  mainCheckouts?: readonly string[]
}

const ALLOW: BashVerdict = { level: 'allow', reason: '' }

function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/* ── 词法拆分 ── */

type Segment = { words: string[]; redirects: string[] }

/**
 * 把命令拆成一段段简单命令（按 && || ; | 换行分），每段拆成词，重定向目标单独拎出来。
 * 只处理引号和反斜杠，不展开变量 —— 带 $ 的词原样留着，交给调用方当「看不清」。
 */
export function splitCommand(command: string): Segment[] {
  const segments: Segment[] = []
  let words: string[] = []
  let redirects: string[] = []
  let word = ''
  let hasWord = false
  let quote: '"' | "'" | null = null
  let pendingRedirect = false
  let pendingInput = false

  const pushWord = () => {
    if (!hasWord) return
    if (pendingInput) {
      pendingInput = false
    } else if (pendingRedirect) {
      redirects.push(word)
      pendingRedirect = false
    } else {
      words.push(word)
    }
    word = ''
    hasWord = false
  }
  const pushSegment = () => {
    pushWord()
    if (words.length || redirects.length) segments.push({ words, redirects })
    words = []
    redirects = []
    pendingRedirect = false
  }

  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (quote) {
      if (ch === quote) quote = null
      else if (ch === '\\' && quote === '"' && i + 1 < command.length) word += command[++i]
      else word += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      hasWord = true
      continue
    }
    if (ch === '\\' && i + 1 < command.length) {
      word += command[++i]
      hasWord = true
      continue
    }
    if (ch === ' ' || ch === '\t') {
      pushWord()
      continue
    }
    if (ch === '\n' || ch === ';' || ch === '|' || ch === '(' || ch === ')') {
      pushSegment()
      continue
    }
    if (ch === '&') {
      if (command[i + 1] === '&') i++
      else if (command[i + 1] === '>') {
        // &> file
        pushWord()
        pendingRedirect = true
        i++
        if (command[i + 1] === '>') i++
        continue
      }
      pushSegment()
      continue
    }
    if (ch === '>' || ch === '<') {
      if (ch === '<') {
        // heredoc：<<EOF / <<'EOF' 后面的正文不是命令，整段截掉
        const rest = command.slice(i)
        const m = /^<<-?\s*['"]?([A-Za-z_][A-Za-z0-9_]*)['"]?/.exec(rest)
        if (m && command[i + 1] === '<') {
          const end = command.indexOf(`\n${m[1]}`, i)
          const lineEnd = command.indexOf('\n', i)
          const tail = lineEnd === -1 ? '' : command.slice(i + m[0].length, lineEnd)
          // 同一行 heredoc 标记后面还可能接 > file 等
          const tailSegs = splitCommand(tail)
          if (tailSegs[0]) {
            words.push(...tailSegs[0].words)
            redirects.push(...tailSegs[0].redirects)
          }
          i = end === -1 ? command.length : end + m[1].length
          continue
        }
        // 单个 < 是读入，后面那个词不是要写的目标
        pushWord()
        pendingInput = true
        continue
      }
      // 2>&1 / >&2 这种是复制文件描述符，不是写文件
      const prefix = word
      if (/^\d+$/.test(prefix)) {
        word = ''
        hasWord = false
      } else {
        pushWord()
      }
      if (command[i + 1] === '>') i++
      if (command[i + 1] === '&') {
        i++
        while (/\d|-/.test(command[i + 1] || '')) i++
        continue
      }
      pendingRedirect = true
      continue
    }
    word += ch
    hasWord = true
  }
  pushSegment()
  return segments
}

/** 去掉 env 赋值、sudo/nohup/setsid/time/env 这类前缀，返回真正的命令词。 */
function stripPrefixes(words: string[]): string[] {
  let i = 0
  while (i < words.length) {
    const w = words[i]
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w)) { i++; continue }
    if (['sudo', 'nohup', 'setsid', 'time', 'exec', 'command', 'xargs'].includes(w)) { i++; continue }
    if (w === 'env') {
      i++
      while (i < words.length && (words[i].startsWith('-') || /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[i]))) i++
      continue
    }
    if (w === 'timeout') {
      i++
      while (i < words.length && words[i].startsWith('-')) i++
      if (i < words.length) i++ // 时长
      continue
    }
    break
  }
  return words.slice(i)
}

function baseName(cmd: string): string {
  return cmd.split('/').pop() || cmd
}

function unclear(p: string): boolean {
  return /[$`]/.test(p) || p.startsWith('~')
}

/* ── git ── */

/** `git -C dir` / `--git-dir` 等全局参数之后的子命令和它的参数。 */
function parseGit(args: string[]): { dir: string | null; sub: string; rest: string[] } {
  let dir: string | null = null
  let i = 0
  while (i < args.length && args[i].startsWith('-')) {
    const a = args[i]
    if (a === '-C' && i + 1 < args.length) { dir = args[i + 1]; i += 2; continue }
    if (a === '-c' && i + 1 < args.length) { i += 2; continue }
    if (a.startsWith('--work-tree=')) { dir = a.slice('--work-tree='.length); i++; continue }
    i++
  }
  return { dir, sub: args[i] || '', rest: args.slice(i + 1) }
}

const MAIN_BRANCHES = new Set(['main', 'master'])

function refspecTargetsMain(spec: string): boolean {
  const target = spec.includes(':') ? spec.split(':').pop() || '' : spec
  const name = target.replace(/^\+/, '').replace(/^refs\/heads\//, '')
  return MAIN_BRANCHES.has(name) || name === 'HEAD'
}

/** git push 是否在「永远要问」里。没写目标分支的也问 —— 可能就是在 main 上。 */
function gitPushRisk(rest: string[]): string | null {
  const flags = rest.filter(a => a.startsWith('-'))
  const positional = rest.filter(a => !a.startsWith('-'))
  if (flags.some(f => f === '-f' || f === '--force' || f.startsWith('--force-with-lease') || f === '--force-if-includes')) {
    return '强推'
  }
  if (flags.some(f => f === '--mirror' || f === '--all' || f === '--delete' || f === '-d' || f === '--prune')) {
    return '批量推送或删除远端分支'
  }
  const specs = positional.slice(1)
  if (specs.length === 0) return '没写目标分支的 push 可能推到 main'
  for (const spec of specs) {
    if (spec.startsWith('+')) return '强推'
    if (spec.startsWith(':')) return '删除远端分支'
    if (refspecTargetsMain(spec)) return 'push main 会触发部署'
  }
  return null
}

/** 改仓库状态的 git 子命令（后台只能在 worktree 里跑）。 */
const GIT_WRITE_SUBS = new Set([
  'commit', 'merge', 'rebase', 'reset', 'checkout', 'switch', 'cherry-pick', 'revert',
  'stash', 'pull', 'am', 'apply', 'tag', 'restore', 'rm', 'mv', 'add', 'clean', 'init',
])

/* ── 写文件的命令 ── */

/** 这些命令的非选项参数都可能被写 / 删。 */
const WRITE_CMDS = new Set(['rm', 'rmdir', 'mv', 'cp', 'mkdir', 'touch', 'chmod', 'chown', 'ln', 'tee', 'truncate', 'shred', 'unlink', 'install', 'rsync', 'patch'])
const DELETE_CMDS = new Set(['rm', 'rmdir', 'shred', 'unlink'])

/** 包管理器：除了只读子命令，都当作在 cwd 里写。 */
const PKG_READONLY: Record<string, Set<string>> = {
  npm: new Set(['test', 't', 'ls', 'list', 'view', 'outdated', 'audit', 'help', 'config', '--version', '-v', 'why', 'explain']),
  pnpm: new Set(['test', 't', 'ls', 'list', 'view', 'outdated', 'audit', 'help', 'why']),
  yarn: new Set(['test', 'list', 'info', 'outdated', 'audit', 'help', 'why']),
  pip: new Set(['list', 'show', 'freeze', 'help', 'check', '--version']),
  pip3: new Set(['list', 'show', 'freeze', 'help', 'check', '--version']),
}

const CREDENTIAL_PATTERNS = [
  /(^|\/)\.git-credentials$/,
  /(^|\/)\.credentials\.json$/,
  /(^|\/)auth\.json$/,
  /(^|\/)\.netrc$/,
]

function touchesCredentials(word: string): boolean {
  if (!word || word.startsWith('-')) {
    const eq = word.indexOf('=')
    if (eq === -1) return false
    word = word.slice(eq + 1)
  }
  return isDeniedPath(word) || CREDENTIAL_PATTERNS.some(re => re.test(word))
}

const SEARCH_CMDS = new Set(['grep', 'egrep', 'fgrep', 'rg', 'ag'])

/* ── 主判断 ── */

/**
 * 判断一条 Bash 命令。前台：allow / ask；后台：allow / deny（没人点卡）。
 */
export function classifyBash(command: string, ctx: BashPolicyContext): BashVerdict {
  const worktreeRoot = ctx.worktreeRoot || WORKTREE_ROOT
  const mainCheckouts = ctx.mainCheckouts || MAIN_CHECKOUTS
  const risky = (reason: string): BashVerdict =>
    ctx.background
      ? { level: 'deny', reason: `后台没人点批准卡，这条在「永远要问」清单里：${reason}。留言告诉小羊，等她来。` }
      : { level: 'ask', reason }
  const bgDeny = (reason: string): BashVerdict => ({
    level: 'deny',
    reason:
      `后台醒来只能在 ${worktreeRoot}/ 下的 worktree 分支里写文件和提交（${reason}）。` +
      `主仓库检出是前台窗口在用的，只读。先 git -C <主仓库> worktree add -b <分支> ${worktreeRoot}/<名字> origin/main，再到那里干活。`,
  })

  const text = String(command || '')
  if (/\b(curl|wget)\b[^\n]*\|\s*(sudo\s+)?(ba|z)?sh\b/.test(text)) return risky('下载脚本直接执行')

  let cwd = path.resolve(ctx.cwd)
  let cwdKnown = true
  const resolve = (p: string) => path.resolve(cwd, p)
  const inWorktree = (abs: string) => isInside(worktreeRoot, abs)
  const inMainCheckout = (abs: string) => !inWorktree(abs) && mainCheckouts.some(root => isInside(root, abs))
  const inWorkspace = (abs: string) => ctx.writeDirs.some(root => isInside(path.resolve(root), abs)) || inWorktree(abs)
  const isWorkspaceRootOrAbove = (abs: string) =>
    [...ctx.writeDirs, ...mainCheckouts, worktreeRoot].some(root => isInside(abs, path.resolve(root)))

  /** 后台写这个路径行不行。/tmp 和 worktree 随便写，主仓库检出不行。 */
  const bgWriteBlocked = (p: string): boolean => {
    if (unclear(p)) return true
    if (p === '/dev/null' || p.startsWith('/dev/')) return false
    if (!cwdKnown && !path.isAbsolute(p)) return true
    return inMainCheckout(resolve(p))
  }

  for (const seg of splitCommand(text)) {
    const words = stripPrefixes(seg.words)

    for (const r of seg.redirects) {
      if (touchesCredentials(r)) return risky('碰凭据文件')
      if (ctx.background && bgWriteBlocked(r)) return bgDeny(`重定向写 ${r}`)
    }
    if (!words.length) continue

    const cmd = baseName(words[0])
    const args = words.slice(1)
    // grep / rg 的第一个位置参数是搜索词，不是文件：搜 "credentials" 这个字符串不算碰凭据
    const pathWords = SEARCH_CMDS.has(cmd)
      ? (() => {
          const pattern = args.findIndex(a => !a.startsWith('-'))
          return pattern === -1 ? args : args.filter((_, i) => i !== pattern)
        })()
      : words
    if (pathWords.some(touchesCredentials)) return risky('碰凭据文件')

    if (cmd === 'cd') {
      const target = args[0]
      if (!target || target === '-' || unclear(target)) cwdKnown = false
      else cwd = resolve(target)
      continue
    }
    if (cmd === 'printenv' || (cmd === 'env' && args.length === 0)) return risky('打印环境变量会带出密钥')
    if (cmd === 'pkill' || cmd === 'killall') return risky('按名字杀进程可能把 dashboard 自己杀掉')
    if (['shutdown', 'reboot', 'halt', 'poweroff', 'mkfs', 'dd'].includes(cmd)) return risky(`${cmd} 是系统级操作`)
    if (cmd === 'curl' || cmd === 'wget' || cmd === 'http') {
      const joined = args.join(' ')
      if (/(^|\s)(-X|--request)\s*DELETE\b/i.test(joined) || /(^|\s)--method=DELETE\b/i.test(joined) || /\bDELETE\s+https?:/.test(joined)) {
        return risky('发 DELETE 请求')
      }
      if (ctx.background) {
        const outIdx = args.findIndex(a => a === '-o' || a === '--output' || a === '-O' || a === '--output-document')
        if (outIdx !== -1 && args[outIdx + 1] && bgWriteBlocked(args[outIdx + 1])) return bgDeny(`下载到 ${args[outIdx + 1]}`)
      }
      continue
    }

    if (cmd === 'git') {
      const g = parseGit(args)
      const gitDir = g.dir ? (unclear(g.dir) ? null : resolve(g.dir)) : cwdKnown ? cwd : null
      if (g.sub === 'push') {
        const why = gitPushRisk(g.rest)
        if (why) return risky(why)
        continue
      }
      if (g.sub === 'reset' && g.rest.includes('--hard')) return risky('git reset --hard 会丢未提交的改动')
      if (g.sub === 'clean' && g.rest.some(a => /^-[a-zA-Z]*f/.test(a) || a === '--force')) return risky('git clean -f 会删未跟踪文件')
      if (g.sub === 'branch' && g.rest.some(a => a === '-D' || a === '-d' || a === '--delete') && g.rest.some(a => MAIN_BRANCHES.has(a))) {
        return risky('删除 main 分支')
      }
      if (ctx.background) {
        const writes =
          GIT_WRITE_SUBS.has(g.sub) ||
          (g.sub === 'branch' && g.rest.some(a => /^-[dDmMfc]$/.test(a) || ['--delete', '--move', '--force', '--copy'].includes(a))) ||
          (g.sub === 'worktree' && ['remove', 'prune', 'move'].includes(g.rest[0] || ''))
        if (g.sub === 'worktree' && g.rest[0] === 'add') {
          const target = g.rest.slice(1).find((a, i, arr) => !a.startsWith('-') && !['-b', '-B'].includes(arr[i - 1] || ''))
          if (!target || unclear(target) || !inWorktree(resolve(target))) return bgDeny('worktree 要开在这个目录下')
          continue
        }
        if (g.sub === 'worktree' && g.rest[0] === 'remove') {
          const target = g.rest.slice(1).find(a => !a.startsWith('-'))
          if (target && !unclear(target) && inWorktree(resolve(target))) continue
          return bgDeny('只能删自己开的 worktree')
        }
        if (writes && (!gitDir || !inWorktree(gitDir))) return bgDeny(`git ${g.sub} 不在 worktree 里`)
      }
      continue
    }

    if (WRITE_CMDS.has(cmd) || cmd === 'sed' || cmd === 'perl' || cmd === 'find') {
      let targets: string[] = []
      if (cmd === 'sed' || cmd === 'perl') {
        if (!args.some(a => /^-[a-zA-Z]*i/.test(a) || a.startsWith('--in-place'))) continue
        targets = args.filter(a => !a.startsWith('-')).slice(1)
      } else if (cmd === 'find') {
        if (!args.some(a => a === '-delete' || a === '-exec' || a === '-execdir')) continue
        targets = args.filter(a => !a.startsWith('-')).slice(0, 1)
        if (args.includes('-delete')) {
          for (const t of targets.length ? targets : ['.']) {
            if (unclear(t) || !cwdKnown) return risky('看不清要删哪里')
            const abs = resolve(t)
            if (!inWorkspace(abs) || isWorkspaceRootOrAbove(abs)) return risky(`删 workspace 外或整个仓库：${t}`)
          }
        }
      } else {
        targets = args.filter(a => !a.startsWith('-'))
        if (cmd === 'chmod' || cmd === 'chown') targets = targets.slice(1)
        // 复制类只写最后一个参数，前面的源只是读
        if (['cp', 'ln', 'install', 'rsync'].includes(cmd)) targets = targets.slice(-1)
      }

      if (DELETE_CMDS.has(cmd)) {
        for (const t of targets) {
          if (unclear(t)) return risky(`看不清要删哪里：${t}`)
          if (!cwdKnown && !path.isAbsolute(t)) return risky(`看不清要删哪里：${t}`)
          const abs = resolve(t)
          if (abs === '/data' || isInside('/data', abs) && !inWorkspace(abs)) return risky('删 /data 下的数据')
          if (!inWorkspace(abs) && !isInside('/tmp', abs)) return risky(`删 workspace 外的文件：${t}`)
          if (isWorkspaceRootOrAbove(abs)) return risky(`删整个仓库或 workspace 根：${t}`)
        }
      }
      if (ctx.background) {
        for (const t of targets) if (bgWriteBlocked(t)) return bgDeny(`${cmd} 写 ${t}`)
      }
      continue
    }

    if (ctx.background && Object.hasOwn(PKG_READONLY, cmd)) {
      let sub = args.find(a => !a.startsWith('-')) || ''
      if (sub === 'run' || sub === 'run-script') {
        const script = args[args.indexOf(sub) + 1] || ''
        if (/^test(:|$)/.test(script) || script === 'lint' || script === 'typecheck') continue
        sub = `run ${script}`
      }
      if (PKG_READONLY[cmd].has(sub)) continue
      if (!cwdKnown || inMainCheckout(cwd)) return bgDeny(`${cmd} ${sub} 会在 ${cwd} 里写文件`)
      continue
    }
  }
  return ALLOW
}
