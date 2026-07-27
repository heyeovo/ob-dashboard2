// 本地排查代理：看清 cc 子进程实际发出去的 cache_control 断点打在哪。
//
// 为什么需要它：断点是 cc 子进程自己拼的，SDK options 里没有这个口子；
// 中转站后台看不到请求正文。只有在中间截一刀才能看见。
//
// 用法（另开一个终端）：
//   CC_PROXY_UPSTREAM=https://你的中转站 node scripts/cc-proxy.mjs
// 然后把 .env.local 的 ANTHROPIC_BASE_URL 改成 http://127.0.0.1:8787 重启 dev。
//
// ⚠️ 只转发、不改正文（改正文那步等看清了再说）。
// ⚠️ 只打印结构和 token 量级，不打印 body 内容、不打印任何 header 值。

import http from 'node:http'
import { Readable } from 'node:stream'

const PORT = Number(process.env.CC_PROXY_PORT || 8787)
const UPSTREAM = (process.env.CC_PROXY_UPSTREAM || '').replace(/\/$/, '')

if (!UPSTREAM) {
  console.error('缺 CC_PROXY_UPSTREAM，例：CC_PROXY_UPSTREAM=https://xxx node scripts/cc-proxy.mjs')
  process.exit(1)
}

/** 粗估 token，只为看量级，不追求准 */
const tok = (s) => Math.round(String(s == null ? '' : s).length / 4)

/** 一段内容（string 或 block 数组）里的字符量 */
function sizeOf(content) {
  if (typeof content === 'string') return tok(content)
  if (!Array.isArray(content)) return 0
  let n = 0
  for (const b of content) {
    if (typeof b === 'string') n += tok(b)
    else if (b && typeof b === 'object') n += tok(b.text || b.content || JSON.stringify(b))
  }
  return n
}

/** 这段内容里有没有 cache_control，打在第几个 block 上 */
function breakpointsIn(content) {
  if (!Array.isArray(content)) return []
  const hits = []
  content.forEach((b, i) => {
    if (b && typeof b === 'object' && b.cache_control) {
      hits.push({ i, ttl: b.cache_control.ttl || '5m' })
    }
  })
  return hits
}

let round = 0

/**
 * 从 SSE 流里挑出 usage。中转站后台只给聚合数字、还得靠时间戳猜是哪一轮；
 * 响应自己带的这份是一一对应的，直接读最准。
 *
 * message_start 里带 input / cache_read / cache_creation，message_delta 里带 output。
 * 只认这几个数字，其余内容一律不看不存。
 */
function makeUsageSniffer(tag) {
  let buf = ''
  let seen = null
  let output = 0
  return {
    feed(chunk) {
      buf += chunk
      // 只留最后一段不完整的行，别把整个响应攒在内存里
      const lines = buf.split('\n')
      buf = lines.pop() || ''
      for (const line of lines) {
        if (!line.startsWith('data:')) continue
        let ev
        try {
          ev = JSON.parse(line.slice(5).trim())
        } catch {
          continue
        }
        const u = ev.message ? ev.message.usage : ev.usage
        if (!u) continue
        if (u.input_tokens !== undefined && !seen) {
          seen = {
            input: u.input_tokens || 0,
            read: u.cache_read_input_tokens || 0,
            write: u.cache_creation_input_tokens || 0,
          }
        }
        if (u.output_tokens) output = u.output_tokens
      }
    },
    done() {
      if (!seen) {
        console.log(`  ${tag} 响应里没读到 usage`)
        return
      }
      const total = seen.input + seen.read + seen.write
      const pct = total ? Math.round((seen.read / total) * 100) : 0
      console.log(
        `  ${tag} 实测 读 ${seen.read}  写 ${seen.write}  新输入 ${seen.input}  ` +
          `输出 ${output}  命中 ${pct}%`,
      )
    },
  }
}

function report(body) {
  round += 1
  const lines = []
  let total = 0
  let bpCount = 0

  // ---- system ----
  const sys = body.system
  const sysBlocks = Array.isArray(sys) ? sys.length : sys ? 1 : 0
  const sysSize = sizeOf(sys)
  const sysBp = breakpointsIn(sys)
  bpCount += sysBp.length
  total += sysSize
  lines.push(
    `  system   ${String(sysBlocks).padStart(3)} 块  ~${String(sysSize).padStart(6)} tok  ` +
      (sysBp.length ? `断点 @block ${sysBp.map((h) => `${h.i}(${h.ttl})`).join(',')}` : '断点 无'),
  )

  // ---- tools ----
  const tools = Array.isArray(body.tools) ? body.tools : []
  const toolSize = tok(JSON.stringify(tools))
  const toolBp = tools.filter((t) => t && t.cache_control).length
  bpCount += toolBp
  total += toolSize
  lines.push(
    `  tools    ${String(tools.length).padStart(3)} 个  ~${String(toolSize).padStart(6)} tok  ` +
      (toolBp ? `断点 ${toolBp} 处` : '断点 无'),
  )

  // ---- messages ----
  const msgs = Array.isArray(body.messages) ? body.messages : []
  let msgTotal = 0
  const msgBp = []
  msgs.forEach((m, i) => {
    const n = sizeOf(m.content)
    msgTotal += n
    const hits = breakpointsIn(m.content)
    if (hits.length) msgBp.push(`#${i}(${m.role},${hits.map((h) => h.ttl).join('/')})`)
  })
  bpCount += msgBp.length
  total += msgTotal
  lines.push(
    `  messages ${String(msgs.length).padStart(3)} 条  ~${String(msgTotal).padStart(6)} tok  ` +
      (msgBp.length ? `断点 @${msgBp.join(' ')}` : '断点 无  ← 历史进不了缓存读就是这个'),
  )

  // 每条消息一行，看新增的轮次落在哪
  const perMsg = msgs
    .map((m, i) => `${i}:${m.role[0]}${sizeOf(m.content)}${breakpointsIn(m.content).length ? '*' : ''}`)
    .join(' ')

  // 没有 tools 的那种请求不是对话，是 cc 自己的杂活（起标题之类）。
  // 打 system 开头认出它是什么 —— 那段是 SDK 的固定文案，不含你的消息内容。
  const isChore = tools.length === 0
  let choreLine = ''
  if (isChore) {
    const sysText = Array.isArray(sys)
      ? sys.map((b) => (typeof b === 'string' ? b : b && b.text) || '').join(' ')
      : String(sys || '')
    choreLine =
      `  ⚙ 杂活请求  model=${body.model || '?'}  max_tokens=${body.max_tokens || '?'}\n` +
      `    system 开头: ${sysText.replace(/\s+/g, ' ').slice(0, 120)}`
  }

  console.log(
    [
      '',
      `── 第 ${round} 个请求 ──  断点合计 ${bpCount}/4  输入 ~${total} tok`,
      ...lines,
      `  逐条: ${perMsg}`,
      `  stream=${body.stream === true}  ttl1h=${JSON.stringify(body).includes('1h')}`,
      ...(choreLine ? [choreLine] : []),
    ].join('\n'),
  )
  return round
}

/**
 * 实验（2026-07-27）：给**倒数第二条** user 消息补一个 cache_control。
 *
 * 为什么补这一条 —— 两轮实测出来的机制：
 *   缓存命中是在**当前请求自己的断点位置上**去查的，不是自动去找「历史上写过
 *   的最长前缀」。SDK 每轮只在最后一条 user 上打一个断点，位置跟着新消息往后
 *   跑：第 3 轮在 #2 写，第 4 轮断点已经移到 #4，#2 那个条目没人去查；第 5 轮
 *   移到 #6，#4 那个又没人查。写了一堆条目全都自生自灭，读只剩 system 那两个
 *   位置固定的断点能命中（稳定 5655）。
 *   证据：两次跑下来读唯一一次超过 5655 是 7360，差值 1705 正好是消息 #0 的量，
 *   而那一轮日志写着「已加 @#0(user)」—— 上一轮在 #0 写的，这一轮在 #0 查到了。
 *
 * ⚠️ 4 个断点是硬上限：system×2 + 最后一条 user（SDK 打的）+ 这里加 1 = 4，顶格。
 * 加完超了就不加，宁可少测一轮也别让请求整个报错。
 *
 * ⚠️ 形状必须每轮一致。上一版只把「被挑中那条」转成 block 数组，而挑中的位置
 * 每轮往后移，于是同一条消息这轮是数组、下轮又变回字符串，缓存逐字节匹配，
 * 前缀从第一条消息就断。所以现在改成**每轮统一规整所有消息**（normalizeShapes），
 * 不管这轮挑中谁。
 *
 * 设 CC_PROXY_EXPERIMENT=0 关掉，退回纯旁观。
 */
// 默认关：它会偷偷改请求，不该是默认值。要做实验时显式 CC_PROXY_EXPERIMENT=1。
const EXPERIMENT = process.env.CC_PROXY_EXPERIMENT === '1'

/**
 * 把所有消息的 string content 统一转成 block 数组。
 * 关键是「统一」：每轮都对全部消息做同样的事，形状才在轮之间稳定。
 * 单看某一条，string 和 [{type:'text'}] 的分词结果是一样的，不影响计费。
 */
function normalizeShapes(msgs) {
  let n = 0
  for (const m of msgs) {
    if (m && typeof m.content === 'string') {
      m.content = [{ type: 'text', text: m.content }]
      n += 1
    }
  }
  return n
}

function addPrevTurnBreakpoint(body) {
  if (!EXPERIMENT) return '关（只看不动，CC_PROXY_EXPERIMENT=1 打开）'
  const msgs = Array.isArray(body.messages) ? body.messages : []
  const shaped = normalizeShapes(msgs)
  const used =
    breakpointsIn(body.system).length +
    (Array.isArray(body.tools) ? body.tools.filter((t) => t && t.cache_control).length : 0) +
    msgs.reduce((n, m) => n + breakpointsIn(m.content).length, 0)
  if (used >= 4) return `规整 ${shaped} 条；断点已满 ${used}/4，不加`

  const userIdx = []
  msgs.forEach((m, i) => {
    if (m && m.role === 'user') userIdx.push(i)
  })
  if (userIdx.length < 2) return `规整 ${shaped} 条；还没有倒数第二条 user，不加`
  const at = userIdx[userIdx.length - 2]
  const target = msgs[at]

  if (!Array.isArray(target.content) || target.content.length === 0) {
    return `规整 ${shaped} 条；content 形状不对，不加`
  }

  const last = target.content[target.content.length - 1]
  if (!last || typeof last !== 'object') return `规整 ${shaped} 条；block 形状不对，不加`
  if (last.cache_control) return `规整 ${shaped} 条；那条上已经有断点，不加`
  last.cache_control = { type: 'ephemeral' }
  return `规整 ${shaped} 条；已加 @#${at}(user) → 断点 ${used + 1}/4`
}

const server = http.createServer((req, res) => {
  const chunks = []
  req.on('data', (c) => chunks.push(c))
  req.on('end', async () => {
    let raw = Buffer.concat(chunks)

    let sniffer = null
    if (req.method === 'POST' && req.url.includes('/v1/messages')) {
      try {
        const body = JSON.parse(raw.toString('utf8'))
        // 先照 cc 原样打印，再改 —— 不然分不清哪个断点是它打的、哪个是我加的
        const n = report(body)
        const note = addPrevTurnBreakpoint(body)
        // 实验关着就连重新序列化都不做，原样字节转发 —— 纯旁观，不给自己制造变量
        if (EXPERIMENT) raw = Buffer.from(JSON.stringify(body), 'utf8')
        console.log(`  实验: ${note}`)
        sniffer = makeUsageSniffer(`第 ${n} 个请求`)
      } catch {
        console.log(`── 请求正文解析不了（${raw.length} 字节），照旧原样转发`)
      }
    }

    const headers = { ...req.headers }
    delete headers.host
    delete headers['content-length']
    delete headers['accept-encoding']

    try {
      const up = await fetch(UPSTREAM + req.url, {
        method: req.method,
        headers,
        body: raw.length ? raw : undefined,
      })
      const out = {}
      up.headers.forEach((v, k) => {
        if (k !== 'content-encoding' && k !== 'content-length') out[k] = v
      })
      res.writeHead(up.status, out)
      if (!up.body) {
        res.end()
        return
      }
      if (!sniffer) {
        Readable.fromWeb(up.body).pipe(res)
        return
      }
      // 边转发边偷看 usage。逐块写出去，不攒不改，流式该多快还多快。
      const src = Readable.fromWeb(up.body)
      src.on('data', (c) => {
        res.write(c)
        try {
          sniffer.feed(c.toString('utf8'))
        } catch {
          /* 偷看失败不能影响转发 */
        }
      })
      src.on('end', () => {
        res.end()
        sniffer.done()
      })
      src.on('error', (e) => {
        console.error('响应流中断:', e.message)
        res.end()
      })
    } catch (e) {
      console.error('转发失败:', e.message)
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message: `本地代理转发失败: ${e.message}` } }))
    }
  })
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`cc 排查代理 → ${UPSTREAM}`)
  console.log(`把 ANTHROPIC_BASE_URL 改成 http://127.0.0.1:${PORT} 再重启 dev\n`)
})
