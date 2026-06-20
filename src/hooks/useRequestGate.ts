import { useCallback, useMemo, useRef } from 'react'

export type RequestGateSource = 'auto' | 'manual'

interface RequestGateOptions {
  autoIntervalMs: number
  manualIntervalMs: number
  autoErrorCooldownMs: number
}

export const RELAXED_SCROLL_REQUEST_GATE: RequestGateOptions = {
  autoIntervalMs: 250,
  manualIntervalMs: 250,
  autoErrorCooldownMs: 15000,
}

export function useRequestGate(options: RequestGateOptions) {
  const lastAttemptRef = useRef(0)
  const lastAutoErrorRef = useRef(0)

  const canStart = useCallback((source: RequestGateSource): boolean => {
    const now = Date.now()
    const minInterval = source === 'auto' ? options.autoIntervalMs : options.manualIntervalMs
    if (now - lastAttemptRef.current < minInterval) return false
    if (source === 'auto' && now - lastAutoErrorRef.current < options.autoErrorCooldownMs) return false
    lastAttemptRef.current = now
    return true
  }, [options.autoErrorCooldownMs, options.autoIntervalMs, options.manualIntervalMs])

  const markAutoError = useCallback(() => {
    lastAutoErrorRef.current = Date.now()
  }, [])

  const reset = useCallback(() => {
    lastAttemptRef.current = 0
    lastAutoErrorRef.current = 0
  }, [])

  return useMemo(() => ({ canStart, markAutoError, reset }), [canStart, markAutoError, reset])
}
