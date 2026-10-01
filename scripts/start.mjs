// Set before Next imports its signal handlers; works in Windows npm and Linux.
process.env.NEXT_MANUAL_SIG_HANDLE = 'true'
process.argv.splice(2, 0, 'start')
await import('next/dist/bin/next')
