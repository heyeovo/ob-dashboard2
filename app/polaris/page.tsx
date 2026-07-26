'use client'

/**
 * Polaris iframe（4.6 之前挂在 / 上）。
 *
 * 4.6 导航重构把 / 让给了 Home，Polaris 移到这里 —— 不占底部 5 Tab，
 * 从 Home 卡片或桌面端左侧栏下半段进。等 /cc 用顺了整页可以直接删。
 */
export default function PolarisPage() {
  return (
    <>
      {/* 桌面端：撑满可视高度（导航是左侧竖栏，不占纵向空间） */}
      <div className="hidden md:flex flex-col h-screen bg-[var(--color-bg)]">
        <iframe
          src="/chat-app/index.html?embed=ob"
          className="flex-1 w-full border-0"
          title="Polaris"
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
          title="Polaris"
          style={{ minHeight: 0 }}
        />
      </div>
    </>
  )
}
