'use client'

import NavBar from './components/NavBar'

export default function ChatHomePage() {
  return (
    <>
      {/* 桌面端：原始布局，NavBar + iframe */}
      <div className="hidden md:flex flex-col h-screen bg-[var(--color-bg)]">
        <NavBar activeSlug="chat" />
        <iframe
          src="/chat-app/index.html?embed=ob"
          className="flex-1 w-full border-0"
          title="Chat"
          style={{ minHeight: 0 }}
        />
      </div>
      {/* 移动端：iframe 底部对齐 BottomTabBar 顶部 */}
      <div
        className="md:hidden flex flex-col bg-[var(--color-bg)]"
        style={{
          height: 'calc(100dvh - 76px - env(safe-area-inset-bottom, 0px))',
        }}
      >
        <iframe
          src="/chat-app/index.html?embed=ob"
          className="flex-1 w-full border-0"
          title="Chat"
          style={{ minHeight: 0 }}
        />
      </div>
    </>
  )
}
