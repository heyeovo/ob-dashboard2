import { redirect } from 'next/navigation'

// 老网址。4.6 之前指向 /（那时 / 是 Polaris iframe）；现在 / 是 Home，
// 「聊天」的落点是 /cc，所以改指这里。要旧前端走 /polaris。
export default function ChatRedirect() {
  redirect('/cc')
}
