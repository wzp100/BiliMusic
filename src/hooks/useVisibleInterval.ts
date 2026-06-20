import { useEffect, useRef } from 'react'

export function useVisibleInterval(callback: () => void, delayMs: number, enabled: boolean) {
  const callbackRef = useRef(callback)

  useEffect(() => {
    callbackRef.current = callback
  }, [callback])

  useEffect(() => {
    if (!enabled || delayMs <= 0) return undefined

    const tick = () => {
      if (document.visibilityState === 'visible') callbackRef.current()
    }

    const intervalId = window.setInterval(tick, delayMs)
    return () => window.clearInterval(intervalId)
  }, [delayMs, enabled])
}
