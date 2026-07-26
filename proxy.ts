import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// 访问口令（第 5 步 ③）。
//
// 为什么现在必须做：之前聊天页只能读代码，最坏情况是别人替你花钱。
// 现在它能改文件、能跑命令 —— 同一个网口暴露在局域网上，谁连上 WiFi 谁就能
// 让它在你电脑上跑命令。写权限一开，这道门就不能再拖。
//
// 怎么用（本机 + 手机）：
//   1. .env.local 里加一行  OB2_LAN_SECRET=你自己编一串
//   2. npm run dev:lan     ← 绑 0.0.0.0，手机才连得上
//   3. 手机浏览器打开  http://<电脑内网IP>:3000/?k=你那串
//      开一次就行，口令会存进 cookie（30 天）
//
// ⚠️ 没设 OB2_LAN_SECRET 时这道门整个不生效 —— 保持现在「打开就能用」的样子，
// 不会让谁某天早上突然被拦在外面。要护住就一定得去 .env.local 加那一行。
//
// ⚠️ 这不是 HTTPS。局域网里传的是明文，口令挡的是「同一个 WiFi 里的别人」，
// 挡不住能抓包的人。别把这个端口转发到公网上。
//
// ⚠️ 本机（127.0.0.1 / ::1）一律放行：你自己在电脑上开发时不该被自己的门拦住。

/** 口令 cookie 的名字。手机上开一次带 ?k= 的链接就写进去，之后不用再带。 */
const COOKIE = 'ob2_lan'

/** cookie 存多久。30 天 —— 手机上不想每天重新贴一次口令。 */
const COOKIE_MAX_AGE = 30 * 24 * 60 * 60

/** 本机地址：自己访问自己，不拦。 */
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1'])

function isLocalRequest(request: NextRequest): boolean {
  const host = (request.headers.get('host') || '').split(':')[0].trim().toLowerCase()
  return LOCAL_HOSTS.has(host) || host === '[::1]'
}

/** 长度相同才逐字比，避免用「第几个字符不对」反推口令。 */
function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

export function proxy(request: NextRequest) {
  const secret = (process.env.OB2_LAN_SECRET || '').trim()
  // 没配口令 = 这道门不存在，跟第 4 步一样直接过
  if (!secret) return NextResponse.next()

  // 自己在电脑上开发，不拦
  if (isLocalRequest(request)) return NextResponse.next()

  // 链接里带了 ?k=（手机第一次打开）→ 存进 cookie，然后把 k 从地址栏里去掉，
  // 免得口令留在历史记录 / 分享出去的链接里
  const fromQuery = request.nextUrl.searchParams.get('k')
  if (fromQuery && sameSecret(fromQuery, secret)) {
    const clean = request.nextUrl.clone()
    clean.searchParams.delete('k')
    const res = NextResponse.redirect(clean)
    res.cookies.set(COOKIE, secret, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: COOKIE_MAX_AGE,
      path: '/',
    })
    return res
  }

  // 之后每次靠 cookie
  const fromCookie = request.cookies.get(COOKIE)?.value || ''
  if (sameSecret(fromCookie, secret)) return NextResponse.next()

  // 没口令：接口回 401（前端能看懂），页面回一段说明
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return NextResponse.json(
      { ok: false, error: '没有访问口令。在链接后面加 ?k=<口令> 打开一次页面。' },
      { status: 401 },
    )
  }
  return new NextResponse(
    `<!doctype html><meta charset="utf-8">` +
      `<meta name="viewport" content="width=device-width,initial-scale=1">` +
      `<div style="font:15px/1.7 system-ui;max-width:22rem;margin:16vh auto;padding:0 1.5rem;color:#3a3734">` +
      `<b style="font-size:17px">这台机器要口令</b>` +
      `<p style="color:#7a7570">在地址后面加 <code>?k=口令</code> 打开一次就行，之后这台设备就记住了。</p>` +
      `<p style="color:#a8a29c;font-size:13px">口令是电脑上 .env.local 里 OB2_LAN_SECRET 那一行。</p>` +
      `</div>`,
    { status: 401, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
  )
}

export const config = {
  // 静态资源不用过这道门（它们不带 cookie 也没用，图标被拦住只会让页面看着像坏了）
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico)$).*)'],
}
