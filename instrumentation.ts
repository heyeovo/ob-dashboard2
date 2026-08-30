export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return
  const { startContextGcScheduler } = await import('./app/lib/contextGcScheduler')
  startContextGcScheduler()
}
