export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startContextGcScheduler, stopContextGcScheduler, isContextGcRunning } = await import('./app/lib/contextGcScheduler')
  const { configureServerDrain, registerDrainSignals } = await import('./app/lib/serverDrain')
  const { unfinishedTurns } = await import('./app/lib/cc/turnBroadcast')
  const { busyCcSessions, markTurnInterrupted, stopSession } = await import('./app/lib/ccSession')
  const { cancelAllPending } = await import('./app/lib/ccChannel')
  const { activeCoordinatorSessions, isCoordinatorBusy } = await import('./app/lib/cc/sessionTurnCoordinator')
  const { isAutomationRunnerBusy } = await import('./app/lib/automationRunnerState')
  configureServerDrain({
    stopSchedulers: stopContextGcScheduler,
    busy: () => unfinishedTurns().length > 0 || busyCcSessions().length > 0
      || isCoordinatorBusy() || isAutomationRunnerBusy() || isContextGcRunning(),
    activeSessions: () => {
      const turns = unfinishedTurns()
      const ids = new Set([...busyCcSessions(), ...activeCoordinatorSessions(), ...turns.map(turn => turn.sessionId)])
      return [...ids].map(sessionId => {
        const turn = turns.find(item => item.sessionId === sessionId)
        return { sessionId, requestId: turn?.requestId || '', startedAt: turn?.startedAt || Date.now() }
      })
    },
    stop: async () => {
      const turns = unfinishedTurns()
      await Promise.allSettled([
        ...turns.map(turn => turn.stop()),
        ...busyCcSessions().filter(id => !turns.some(turn => turn.sessionId === id)).map(async id => {
          markTurnInterrupted(id)
          cancelAllPending(id, '部署排空到达上限，这一轮优雅停止。')
          await stopSession(id)
        }),
      ])
    },
  })
  registerDrainSignals()
  startContextGcScheduler()
}
