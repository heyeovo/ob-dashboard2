'use client'

import NavBar from './components/NavBar'

export default function ChatHomePage() {
  return (
    <>
      <NavBar activeSlug="chat" />
      <iframe
        src="/chat-app/index.html?embed=ob"
        className="w-full border-0 md:h-[calc(100vh-56px)] h-[calc(100dvh-72px-env(safe-area-inset-bottom,0px))]"
        title="Chat"
        style={{ minHeight: 0 }}
      />
    </>
  )
}
