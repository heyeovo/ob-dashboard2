'use client'

import NavBar from './components/NavBar'
import MobileShell from './components/MobileShell'

export default function ChatHomePage() {
  return (
    <div className="flex flex-col bg-[var(--color-bg)] h-dvh overflow-hidden">
      <NavBar activeSlug="chat" />
      <iframe
        src="/chat-app/index.html?layout=phone&embed=ob"
        className="flex-1 w-full border-0"
        title="Chat"
        style={{ minHeight: 0 }}
      />
    </div>
  )
}
