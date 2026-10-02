import Image from 'next/image'

export default function HomeSillArt({ kind }: { kind: 'cat' | 'clawd' }) {
  // 奶糖是 GPT 按照片画的，木板已抠掉（public/home/naitang.png，480×325）。
  // 原木板上沿在图高 72% 处：CSS 让这条线压在窗的下沿，爪子和尾巴垂到窗外
  if (kind === 'cat') return (
    // unoptimized：优化器在服务端取图时不带登录 cookie，会被 proxy.ts 挡回登录页；图已预先压好
    <Image className="home-sill-cat" src="/home/naitang.png" width={480} height={325} alt="奶糖趴在窗沿上" priority unoptimized />
  )
  return <Image src="/home/clawd.webp" width={360} height={360} alt="Clawd" unoptimized />
}
