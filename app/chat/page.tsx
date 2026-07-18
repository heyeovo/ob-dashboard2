'use client'

import NavBar from '../components/NavBar'
import MobileShell from '../components/MobileShell'

export default function ChatPage() {
  return (
    <MobileShell>
      <div className="flex flex-col h-screen bg-[var(--color-bg)]">
        <NavBar activeSlug="chat" />
        <iframe
          src="/chat-app/index.html"
          className="flex-1 w-full border-0"
          title="Chat"
          style={{ minHeight: 0 }}
        />
      </div>
    </MobileShell>
  )
}
