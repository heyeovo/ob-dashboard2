import Image from 'next/image'

export default function HomeSillArt({ kind }: { kind: 'cat' | 'clawd' }) {
  // 奶糖是 GPT 按照片画的，木板已抠掉（public/home/naitang.png，480×325）。
  // 原木板上沿在图高 72% 处：CSS 让这条线压在窗的下沿，爪子和尾巴垂到窗外
  if (kind === 'cat') return (
    // unoptimized：优化器在服务端取图时不带登录 cookie，会被 proxy.ts 挡回登录页；图已预先压好
    <Image className="home-sill-cat" src="/home/naitang.png" width={480} height={325} alt="奶糖趴在窗沿上" priority unoptimized />
  )
  return (
    <svg className="home-sill-clawd" viewBox="0 0 40 34" aria-label="Clawd 站在纪念日卡上" role="img">
      <g style={{ fill: 'var(--color-primary)' }}>
        <rect x="5" y="4" width="30" height="20" rx="3" />
        <rect x="0" y="11" width="6" height="7" rx="1.5" />
        <rect x="34" y="11" width="6" height="7" rx="1.5" />
        <rect x="8" y="23" width="4" height="10" rx="1" />
        <rect x="15" y="23" width="4" height="10" rx="1" />
        <rect x="21" y="23" width="4" height="10" rx="1" />
        <rect x="28" y="23" width="4" height="10" rx="1" />
      </g>
      <rect x="9" y="10" width="22" height="5" rx="2" style={{ fill: 'var(--home-clawd-glasses)' }} />
    </svg>
  )
}
