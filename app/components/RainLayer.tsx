'use client'

import { useEffect, useState } from 'react'
import { useAppearance } from './AppearanceProvider'

export default function RainLayer() {
  const { appearance } = useAppearance()
  const [paused, setPaused] = useState(false)

  useEffect(() => {
    const sync = () => setPaused(document.hidden)
    sync()
    document.addEventListener('visibilitychange', sync)
    return () => document.removeEventListener('visibilitychange', sync)
  }, [])

  if (appearance.effects.rain.mode !== 'on') return null
  return <div aria-hidden="true" className="rain-layer" data-paused={paused} />
}
