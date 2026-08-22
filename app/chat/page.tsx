import { redirect } from 'next/navigation'

// 老网址保留跳转；当前聊天入口统一落到 /cc。
export default function ChatRedirect() {
  redirect('/cc')
}
