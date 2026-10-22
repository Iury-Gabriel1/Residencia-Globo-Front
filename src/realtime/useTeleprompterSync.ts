import { useEffect, useMemo, useRef, useState } from 'react'

export type RealtimeCommand =
  | 'pause'
  | 'resume'
  | 'next'
  | 'previous'
  | 'select_story'
  | 'select_page'
  | 'take_control'

export type SharedTeleprompterState = {
  selectedStory: number
  pageIndex: number
  paused: boolean
  speed: number
  fontSize: number
  editorialStories: unknown[]
  operatorOverride: boolean
}

type ServerMessage = {
  type?: string
  state?: SharedTeleprompterState | null
  message?: string
}

type Options = {
  sessionId: string
  state: SharedTeleprompterState
  onRemoteState: (state: SharedTeleprompterState) => void
}

const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, '')
const WS_URL = (import.meta.env.VITE_WS_URL as string | undefined)?.replace(/\/$/, '')

function websocketUrl(sessionId: string) {
  if (WS_URL) return `${WS_URL}/ws/${encodeURIComponent(sessionId)}`
  if (API_URL) {
    const url = new URL(API_URL)
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${url.toString().replace(/\/$/, '')}/ws/${encodeURIComponent(sessionId)}`
  }
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.hostname}:8000/ws/${encodeURIComponent(sessionId)}`
}

function createClientId() {
  return `client-${Math.random().toString(36).slice(2, 10)}`
}

export function useTeleprompterSync({ sessionId, state, onRemoteState }: Options) {
  const [status, setStatus] = useState<'connecting' | 'connected' | 'reconnecting' | 'offline'>('connecting')
  const socketRef = useRef<WebSocket | null>(null)
  const callbackRef = useRef(onRemoteState)
  const stateRef = useRef(state)
  const lastReceivedSignature = useRef('')
  const lastSentSignature = useRef('')
  const clientId = useMemo(createClientId, [])
  const stateSignature = JSON.stringify(state)

  useEffect(() => { callbackRef.current = onRemoteState }, [onRemoteState])
  useEffect(() => { stateRef.current = state }, [stateSignature])

  useEffect(() => {
    let disposed = false
    let retryTimer: number | undefined
    let retryDelay = 800

    const connect = () => {
      if (disposed) return
      setStatus(socketRef.current ? 'reconnecting' : 'connecting')
      let socket: WebSocket
      try {
        socket = new WebSocket(websocketUrl(sessionId))
      } catch {
        setStatus('offline')
        retryTimer = window.setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 1.7, 10000)
        return
      }
      socketRef.current = socket

      socket.onopen = () => {
        retryDelay = 800
        setStatus('connected')
      }

      socket.onmessage = event => {
        let message: ServerMessage & { source?: string; type?: string }
        try { message = JSON.parse(String(event.data)) as typeof message } catch { return }
        if (message.type === 'welcome') {
          if (message.state) {
            lastReceivedSignature.current = JSON.stringify(message.state)
            callbackRef.current(message.state)
          } else {
            const current = stateRef.current
            const signature = JSON.stringify(current)
            lastSentSignature.current = signature
            socket.send(JSON.stringify({ type: 'sync', clientId, state: current }))
          }
          return
        }
        if ((message.type === 'state' || message.type === 'command') && message.state) {
          const signature = JSON.stringify(message.state)
          lastReceivedSignature.current = signature
          if (signature !== JSON.stringify(stateRef.current)) callbackRef.current(message.state)
        }
      }

      socket.onerror = () => setStatus('reconnecting')
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        if (disposed) return
        setStatus('reconnecting')
        retryTimer = window.setTimeout(connect, retryDelay)
        retryDelay = Math.min(retryDelay * 1.7, 10000)
      }
    }

    connect()
    return () => {
      disposed = true
      if (retryTimer !== undefined) window.clearTimeout(retryTimer)
      const socket = socketRef.current
      socketRef.current = null
      if (socket) {
        socket.onclose = null
        socket.close()
      }
    }
  }, [sessionId, clientId])

  useEffect(() => {
    const socket = socketRef.current
    if (!socket || socket.readyState !== WebSocket.OPEN) return
    if (stateSignature === lastReceivedSignature.current || stateSignature === lastSentSignature.current) return
    lastSentSignature.current = stateSignature
    socket.send(JSON.stringify({ type: 'sync', clientId, state }))
  }, [stateSignature, clientId, state])

  function sendCommand(command: RealtimeCommand, patch: Partial<SharedTeleprompterState> = {}) {
    const socket = socketRef.current
    const nextState = { ...stateRef.current, ...patch }
    stateRef.current = nextState
    if (!socket || socket.readyState !== WebSocket.OPEN) return false
    const signature = JSON.stringify(nextState)
    lastSentSignature.current = signature
    socket.send(JSON.stringify({ type: 'command', clientId, command, state: nextState }))
    return true
  }

  return { status, sendCommand, sessionId }
}
