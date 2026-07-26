'use client'
import { useSyncExternalStore } from 'react'

/**
 * 这一页是不是在「线上」打开的（4.6 导航重构）。
 *
 * 背景：/cc 依赖 claude code 子进程，只能在家里那台机器的 dev server 上跑。
 * Vercel 的 serverless 上没有那个二进制，也不能跑长驻子进程 —— 页面能打开，
 * 一发言就报错。这不是 bug（方案里早就定了「改代码只在本地可用」），
 * 但界面上得给一句话，别让人对着报错猜。
 *
 * 判断方式：**浏览器里看 hostname**，不看环境变量。
 * 理由：手机走局域网访问的是 http://192.168.x.x:3000，那也是「本地」，
 * 而服务端环境变量分不出这两者（同一个 dev server）。换域名也不用改代码。
 *
 * 返回 null = 服务端渲染那一帧（还不知道 hostname），客户端接手后立刻变成真假。
 * 用 useSyncExternalStore 而不是 useEffect + setState：hostname 是外部只读值、
 * 不会变，这样写没有级联渲染，也不触发 react-hooks/set-state-in-effect。
 */

function localHostname(host: string) {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true
  if (host.endsWith('.local') || host.endsWith('.localhost')) return true
  // 局域网私有地址段：10.x / 192.168.x / 172.16-31.x
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true
  const m = /^172\.(\d+)\./.exec(host)
  if (m) {
    const second = Number(m[1])
    if (second >= 16 && second <= 31) return true
  }
  return false
}

// hostname 在页面生命周期里不会变，所以订阅函数是个空壳
const subscribe = () => () => {}

export function useIsRemote(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => !localHostname(window.location.hostname),
    () => null, // 服务端快照
  )
}
