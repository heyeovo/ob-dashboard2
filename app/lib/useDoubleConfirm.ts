'use client'

import { useEffect, useRef, useState } from 'react'

/** A second click on the same target must arrive within three seconds. */
export function useDoubleConfirm() {
  const [armed, setArmed] = useState('')
  const target = useRef('')
  const deadline = useRef(0)
  useEffect(() => {
    if (!armed) return
    const timer = setTimeout(() => { setArmed(''); target.current = ''; deadline.current = 0 }, 3000)
    return () => clearTimeout(timer)
  }, [armed])
  function confirm(value: string, action: () => void) {
    if (target.current === value && Date.now() < deadline.current) {
      target.current = ''; deadline.current = 0; setArmed(''); action()
    } else {
      target.current = value; deadline.current = Date.now() + 3000; setArmed(value)
    }
  }
  return { armed, confirm }
}
