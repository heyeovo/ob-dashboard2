// 批准卡片上那段 diff 的服务端拼装。
//
// 为什么在服务端做：这里能读磁盘。Write 要跟文件现在的内容比，Edit 要定位那段
// old_string 在第几行 —— 都得看真实文件。前端只负责把结果画出来。
//
// 用的是最朴素的 LCS 行比对，没上依赖。批准卡片里的 diff 是给人瞟一眼确认
// 「改的是不是我想的那个地方」，不是给代码审查用的，够了。

import fs from 'node:fs/promises'
import path from 'node:path'
import type { CcDiffLine, CcDiffPreview } from './ccChannel'

/** 一张卡片最多显示多少行。太长了手机上根本翻不完。 */
const MAX_LINES = 160
/** 变动前后各留几行上下文 */
const CONTEXT = 3

function splitLines(text: string): string[] {
  return text.replace(/\r\n/g, '\n').split('\n')
}

/**
 * 行级 LCS。文件几千行时是 O(n*m)，够用 —— 真超大文件下面会先截断。
 * 返回的是编辑脚本，直接就是要渲染的样子。
 */
function diffLines(before: string[], after: string[]): CcDiffLine[] {
  const n = before.length
  const m = after.length
  // 太大就不做精细比对了，直接整段替换显示，免得把 dev server 卡住
  if (n * m > 4_000_000) {
    return [
      ...before.map(text => ({ tag: '-' as const, text })),
      ...after.map(text => ({ tag: '+' as const, text })),
    ]
  }

  // dp[i][j] = before[i..] 和 after[j..] 的最长公共子序列长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0))
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }

  const out: CcDiffLine[] = []
  let i = 0
  let j = 0
  while (i < n && j < m) {
    if (before[i] === after[j]) {
      out.push({ tag: ' ', text: before[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ tag: '-', text: before[i] })
      i++
    } else {
      out.push({ tag: '+', text: after[j] })
      j++
    }
  }
  while (i < n) out.push({ tag: '-', text: before[i++] })
  while (j < m) out.push({ tag: '+', text: after[j++] })
  return out
}

/** 只留变动附近的几行，中间大段没动的折成一条省略行。 */
function trimContext(lines: CcDiffLine[]): { lines: CcDiffLine[]; truncated: boolean } {
  const keep = new Set<number>()
  lines.forEach((line, idx) => {
    if (line.tag === ' ') return
    for (let k = idx - CONTEXT; k <= idx + CONTEXT; k++) {
      if (k >= 0 && k < lines.length) keep.add(k)
    }
  })
  if (keep.size === 0) return { lines: [], truncated: false }

  const out: CcDiffLine[] = []
  let skipping = false
  for (let idx = 0; idx < lines.length; idx++) {
    if (keep.has(idx)) {
      out.push(lines[idx])
      skipping = false
    } else if (!skipping) {
      out.push({ tag: ' ', text: '⋯' })
      skipping = true
    }
  }
  if (out.length <= MAX_LINES) return { lines: out, truncated: false }
  return { lines: out.slice(0, MAX_LINES), truncated: true }
}

function count(lines: CcDiffLine[]) {
  let added = 0
  let removed = 0
  for (const l of lines) {
    if (l.tag === '+') added++
    else if (l.tag === '-') removed++
  }
  return { added, removed }
}

async function readIfExists(target: string): Promise<string | null> {
  try {
    return await fs.readFile(target, 'utf8')
  } catch {
    return null
  }
}

function build(target: string, beforeText: string, afterText: string, note: string): CcDiffPreview {
  const raw = diffLines(splitLines(beforeText), splitLines(afterText))
  const { added, removed } = count(raw)
  const trimmed = trimContext(raw)
  return {
    path: target,
    lines: trimmed.lines,
    added,
    removed,
    truncated: trimmed.truncated,
    note,
  }
}

/**
 * Edit 的 diff。
 *
 * 先把 old_string 换成 new_string 得到「改完的样子」，再跟磁盘上现在的比。
 * 这样出来的行号和上下文都是真的。文件读不到（或者根本没匹配上）就退化成
 * 「只比对替换的那两段」—— 那也比不给看强。
 */
export async function diffForEdit(input: {
  file_path?: unknown
  old_string?: unknown
  new_string?: unknown
  replace_all?: unknown
}): Promise<CcDiffPreview> {
  const target = String(input.file_path || '')
  const oldStr = String(input.old_string ?? '')
  const newStr = String(input.new_string ?? '')
  const current = await readIfExists(target)

  if (current === null) {
    return build(target, oldStr, newStr, '读不到文件原文，只比对替换的那一段')
  }
  if (oldStr && !current.includes(oldStr)) {
    return build(target, oldStr, newStr, '这段原文在文件里没找到，只比对替换的那一段（这个操作很可能会失败）')
  }
  const next = input.replace_all
    ? current.split(oldStr).join(newStr)
    : current.replace(oldStr, newStr)
  return build(target, current, next, '')
}

/** Write 的 diff。文件不存在就是新建，整段都算新增。 */
export async function diffForWrite(input: {
  file_path?: unknown
  content?: unknown
}): Promise<CcDiffPreview> {
  const target = String(input.file_path || '')
  const content = String(input.content ?? '')
  const current = await readIfExists(target)
  if (current === null) {
    return build(target, '', content, `新建文件（${path.basename(target)} 现在不存在）`)
  }
  return build(target, current, content, '整份覆盖现有文件')
}

/** NotebookEdit 之类：拿不到结构化 diff，给一段参数摘要就行。 */
export function diffPlaceholder(target: string, note: string): CcDiffPreview {
  return { path: target, lines: [], added: 0, removed: 0, truncated: false, note }
}
