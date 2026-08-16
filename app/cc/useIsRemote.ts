'use client'
import { useSyncExternalStore } from 'react'

/**
 * 这一页是不是在 Vercel 打开的（4.6 导航重构）。
 *
 * 背景：/cc 依赖 claude code 子进程，只能在包含该运行时的本机或 Coolify/VPS 上跑。
 * Vercel 的 serverless 上没有那个二进制，也不能跑长驻子进程 —— 页面能打开，
 * 一发言就报错。这不是 bug（方案里早就定了「改代码只在本地可用」），
 * 但界面上得给一句话，别让人对着报错猜。
 *
 * 判断方式：**浏览器里看 hostname**，只把 vercel.app 官方域名当成 Vercel。
 * Coolify/VPS 同样使用公网域名，不能再用「非 localhost/局域网」作为 Vercel 的代替判断。
 *
 * 返回 null = 服务端渲染那一帧（还不知道 hostname），客户端接手后立刻变成真假。
 * 用 useSyncExternalStore 而不是 useEffect + setState：hostname 是外部只读值、
 * 不会变，这样写没有级联渲染，也不触发 react-hooks/set-state-in-effect。
 */

export function vercelHostname(host: string) {
  const normalized = host.trim().toLowerCase().replace(/\.$/, '')
  return normalized === 'vercel.app' || normalized.endsWith('.vercel.app')
}

// hostname 在页面生命周期里不会变，所以订阅函数是个空壳
const subscribe = () => () => {}

export function useIsRemote(): boolean | null {
  return useSyncExternalStore(
    subscribe,
    () => vercelHostname(window.location.hostname),
    () => null, // 服务端快照
  )
}
