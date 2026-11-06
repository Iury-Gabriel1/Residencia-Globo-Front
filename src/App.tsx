import { useEffect, useMemo, useRef, useState, type ChangeEvent } from 'react'
import storyData from './data/stories.json'
import type { RealtimeState, Story } from './types/script'
import { ScriptEditor, ScriptText } from './components/ScriptText'
import './components/ScriptText.css'

const initialStories = storyData as Story[]
type Tab = 'Preparar roteiro' | 'Editor de roteiro' | 'Operação ao vivo' | 'Improvisos' | 'Leitura ampliada' | 'Apresentador'
type ReadingPreferences = { fontFamily: string; backgroundColor: string; textColor: string; highContrast: boolean }
const DEFAULT_PREFERENCES: ReadingPreferences = { fontFamily: 'Arial, Helvetica, sans-serif', backgroundColor: '#0d1322', textColor: '#f4f6fd', highContrast: false }
const PREFERENCES_KEY = 'teleprompter-reading-preferences-v1'
const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const SESSION_ID = new URLSearchParams(window.location.search).get('session') || 'demo'
const categories: Story['category'][] = ['Cidade', 'Previsão do tempo', 'Economia', 'Política', 'Cultura', 'Notícia séria', 'Falecimento', 'Conteúdo leve']
const LIVE_AUDIO_SAMPLE_RATE = 24000
const LIVE_AUDIO_MAX_SEGMENT_SECONDS = 5

type ScriptWord = { normalized: string; end: number }
type LiveSpeechAssessment = {
  message: string
  kind: 'waiting' | 'match' | 'omission' | 'repetition' | 'resumption' | 'improviso'
}

function getScriptWords(text: string): ScriptWord[] {
  return Array.from(text.matchAll(/[\p{L}\p{N}]+/gu), match => ({
    normalized: match[0].normalize('NFD').replace(/\p{M}/gu, '').toLowerCase(),
    end: (match.index ?? 0) + match[0].length
  }))
}

function findScriptMatch(script: string, transcript: string, searchFrom: number) {
  const scriptWords = getScriptWords(script)
  const spokenWords = getScriptWords(transcript).slice(-12)
  const longestMatch = Math.min(8, spokenWords.length)
  if (longestMatch < 4 || scriptWords.length === 0) return null

  for (let length = longestMatch; length >= 4; length--) {
    const phrase = spokenWords.slice(-length).map(word => word.normalized)
    const candidates: Array<{ startWord: number; word: number; totalWords: number; length: number; differences: number }> = []
    for (let start = 0; start <= scriptWords.length - length; start++) {
      let differences = 0
      for (let offset = 0; offset < length; offset++) {
        if (scriptWords[start + offset].normalized !== phrase[offset]) differences++
      }
      const allowedDifferences = length >= 6 ? 1 : 0
      const endWord = start + length
      if (differences <= allowedDifferences) {
        candidates.push({
          startWord: start,
          word: endWord,
          totalWords: scriptWords.length,
          length,
          differences
        })
      }
    }
    if (candidates.length === 0) continue
    candidates.sort((left, right) => {
      const leftBehind = left.word < searchFrom - 2
      const rightBehind = right.word < searchFrom - 2
      if (leftBehind !== rightBehind) return leftBehind ? 1 : -1
      if (left.differences !== right.differences) return left.differences - right.differences
      return Math.abs(left.startWord - searchFrom) - Math.abs(right.startWord - searchFrom)
    })
    const best = candidates[0]
    return {
      startWord: best.startWord,
      word: best.word,
      totalWords: best.totalWords,
      length: best.length
    }
  }
  return null
}

function encodePcm16Base64(input: Float32Array, inputSampleRate: number) {
  const ratio = inputSampleRate / LIVE_AUDIO_SAMPLE_RATE
  const outputLength = Math.floor(input.length / ratio)
  if (outputLength === 0) return { audio: '', samples: 0 }

  const bytes = new Uint8Array(outputLength * 2)
  const data = new DataView(bytes.buffer)
  for (let index = 0; index < outputLength; index++) {
    const sourceIndex = index * ratio
    const lowerIndex = Math.floor(sourceIndex)
    const upperIndex = Math.min(lowerIndex + 1, input.length - 1)
    const fraction = sourceIndex - lowerIndex
    const sample = input[lowerIndex] * (1 - fraction) + input[upperIndex] * fraction
    const pcm = Math.max(-1, Math.min(1, sample))
    data.setInt16(index * 2, pcm < 0 ? pcm * 0x8000 : pcm * 0x7fff, true)
  }

  let binary = ''
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000))
  }
  return { audio: btoa(binary), samples: outputLength }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function parseRundownJson(value: unknown): Story[] {
  const stories = Array.isArray(value) ? value : isRecord(value) ? value.stories : undefined
  if (!Array.isArray(stories) || stories.length === 0) throw new Error('O arquivo precisa conter uma lista não vazia de matérias.')
  for (const [storyIndex, item] of stories.entries()) {
    if (!isRecord(item) || !['id', 'code', 'headline', 'category', 'tone'].every(key => typeof item[key] === 'string')) {
      throw new Error(`Matéria ${storyIndex + 1}: campos id, code, headline, category e tone são obrigatórios.`)
    }
    if (!categories.includes(item.category as Story['category']) || typeof item.guidance !== 'string') {
      throw new Error(`Matéria ${storyIndex + 1}: categoria ou orientação inválida.`)
    }
    if (!Array.isArray(item.pages) || item.pages.length === 0) throw new Error(`Matéria ${storyIndex + 1}: inclua ao menos uma página.`)
    for (const [pageIndex, page] of item.pages.entries()) {
      if (!isRecord(page) || !['id', 'title', 'label', 'text'].every(key => typeof page[key] === 'string') ||
          !Array.isArray(page.keywords) || !page.keywords.every(keyword => typeof keyword === 'string') ||
          (page.secondary !== undefined && typeof page.secondary !== 'string')) {
        throw new Error(`Matéria ${storyIndex + 1}, página ${pageIndex + 1}: dados incompletos ou inválidos.`)
      }
    }
  }
  return stories as Story[]
}

function contrastRatio(foreground: string, background: string) {
  const luminance = (hex: string) => {
    const value = hex.replace('#', '')
    const rgb = value.length === 3 ? value.split('').map(char => parseInt(char + char, 16)) : [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)]
    const channels = rgb.map(channel => { const normalized = channel / 255; return normalized <= 0.04045 ? normalized / 12.92 : ((normalized + 0.055) / 1.055) ** 2.4 })
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]
  }
  const a = luminance(foreground); const b = luminance(background)
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
}

function App() {
  const [tab, setTab] = useState<Tab>('Operação ao vivo')
  const [editorialStories, setEditorialStories] = useState<Story[]>(() => { try { const saved = localStorage.getItem('teleprompter-editorial-stories-v1'); return saved ? JSON.parse(saved) as Story[] : initialStories } catch { return initialStories } })
  const [selectedStory, setSelectedStory] = useState(0)
  const [pageIndex, setPageIndex] = useState(0)
  const [scrollPosition, setScrollPosition] = useState(0)
  const [paused, setPaused] = useState(true)
  const [importStories, setImportStories] = useState<Story[] | null>(null)
  const [importFileName, setImportFileName] = useState('')
  const [importStatus, setImportStatus] = useState('')
  const [importing, setImporting] = useState(false)
  const [audioFile, setAudioFile] = useState<File | null>(null)
  const [recording, setRecording] = useState(false)
  const [audioTranscript, setAudioTranscript] = useState('')
  const [transcriptionStatus, setTranscriptionStatus] = useState('')
  const [transcribing, setTranscribing] = useState(false)
  const [liveTranscribing, setLiveTranscribing] = useState(false)
  const [liveFinalizing, setLiveFinalizing] = useState(false)
  const [liveTranscriptionStatus, setLiveTranscriptionStatus] = useState('')
  const [liveTranscript, setLiveTranscript] = useState('')
  const [liveInputLevel, setLiveInputLevel] = useState(0)
  const [liveSpeechAssessment, setLiveSpeechAssessment] = useState<LiveSpeechAssessment>({
    message: 'A fala reconhecida aparecerá aqui quando você iniciar o microfone.',
    kind: 'waiting'
  })
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordingChunksRef = useRef<Blob[]>([])
  const liveTranscriptionSocketRef = useRef<WebSocket | null>(null)
  const liveAudioContextRef = useRef<AudioContext | null>(null)
  const liveAudioStreamRef = useRef<MediaStream | null>(null)
  const liveAudioSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const liveAudioProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const liveAudioGainRef = useRef<GainNode | null>(null)
  const liveTranscriptionReadyRef = useRef(false)
  const liveTranscribingRef = useRef(false)
  const liveFinalizingRef = useRef(false)
  const liveStopTimerRef = useRef<number | null>(null)
  const liveSamplesInTurnRef = useRef(0)
  const liveSilenceSamplesRef = useRef(0)
  const liveTurnHasSpeechRef = useRef(false)
  const livePreRollChunksRef = useRef<Array<{ audio: string; samples: number }>>([])
  const livePreRollSamplesRef = useRef(0)
  const liveAudioLevelUpdateAtRef = useRef(0)
  const liveItemOrderRef = useRef<string[]>([])
  const liveItemTranscriptsRef = useRef<Record<string, string>>({})
  const livePendingItemIdsRef = useRef<Set<string>>(new Set())
  const liveCompletedItemIdsRef = useRef<Set<string>>(new Set())
  const liveStopWaitingForCommitRef = useRef(false)
  const liveLastEvaluatedSpeechRef = useRef('')
  const alignmentCursorRef = useRef(0)
  const alignmentTargetRef = useRef('')
  const [speed, setSpeed] = useState(() => { try { const saved = localStorage.getItem(PREFERENCES_KEY); return saved ? Number(JSON.parse(saved).speed) || 1 : 1 } catch { return 1 } })
  const [fontSize, setFontSize] = useState(() => { try { const saved = localStorage.getItem(PREFERENCES_KEY); return saved ? Number(JSON.parse(saved).fontSize) || 36 : 36 } catch { return 36 } })
  const [preferences, setPreferences] = useState<ReadingPreferences>(() => { try { const saved = localStorage.getItem(PREFERENCES_KEY); if (saved) { const parsed = JSON.parse(saved); return { ...DEFAULT_PREFERENCES, ...parsed.preferences } } } catch { /* usa os padrões */ } return DEFAULT_PREFERENCES })
  const [showReadingSettings, setShowReadingSettings] = useState(false)
  const [backendStatus, setBackendStatus] = useState<'connecting' | 'connected' | 'disconnected'>('connecting')
  const [reviewed, setReviewed] = useState(false)
  const [operatorNote, setOperatorNote] = useState('Comentário espontâneo sobre a espera dos passageiros. Mantive o ponto de leitura e retomei na linha 05 após o fim da fala. Sem alteração do roteiro original.')
  const [showExpanded, setShowExpanded] = useState(false)
  const [filter, setFilter] = useState('Todas as matérias')
  const [classificationSaved, setClassificationSaved] = useState(true)
  const [operatorOverride, setOperatorOverride] = useState(false)
  const presenterTextRef = useRef<HTMLDivElement>(null)
  const scrollSyncTimer = useRef<number | null>(null)
  const stateSyncTimerRef = useRef<number | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const remoteStateRef = useRef<string | null>(null)
  const welcomeReceivedRef = useRef(false)
  const localChangesPendingRef = useRef(false)
  const latestStateRef = useRef<RealtimeState>({
    selectedStory,
    pageIndex,
    scrollPosition,
    paused,
    speed,
    fontSize,
    editorialStories,
    operatorOverride,
    readingPreferences: preferences
  })

  useEffect(() => () => {
    const recorder = mediaRecorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      recorder.onerror = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    mediaStreamRef.current?.getTracks().forEach(track => track.stop())
    liveTranscribingRef.current = false
    if (liveStopTimerRef.current !== null) window.clearTimeout(liveStopTimerRef.current)
    liveAudioProcessorRef.current?.disconnect()
    liveAudioSourceRef.current?.disconnect()
    liveAudioGainRef.current?.disconnect()
    liveAudioStreamRef.current?.getTracks().forEach(track => track.stop())
    const liveAudioContext = liveAudioContextRef.current
    if (liveAudioContext && liveAudioContext.state !== 'closed') {
      void liveAudioContext.close().catch(error => console.error('Falha ao encerrar o áudio em tempo real.', error))
    }
    liveTranscriptionSocketRef.current?.close()
  }, [])

  function applyRemoteState(state: RealtimeState) {
    if (!Array.isArray(state.editorialStories) || state.editorialStories.length === 0) {
      console.error('O backend enviou um espelho vazio ou inválido.')
      return
    }
    const safeStoryIndex = Math.min(Math.max(state.selectedStory, 0), state.editorialStories.length - 1)
    const storyPages = state.editorialStories[safeStoryIndex]?.pages ?? []
    const safePageIndex = storyPages.length
      ? Math.min(Math.max(state.pageIndex, 0), storyPages.length - 1)
      : 0
    const normalizedState = {
      ...state,
      selectedStory: safeStoryIndex,
      pageIndex: safePageIndex,
      scrollPosition: Math.min(1, Math.max(0, state.scrollPosition ?? 0))
    }
    remoteStateRef.current = JSON.stringify(normalizedState)
    setEditorialStories(normalizedState.editorialStories)
    setSelectedStory(safeStoryIndex)
    setPageIndex(safePageIndex)
    setScrollPosition(normalizedState.scrollPosition)
    setPaused(normalizedState.paused)
    setSpeed(normalizedState.speed)
    setFontSize(normalizedState.fontSize)
    setOperatorOverride(normalizedState.operatorOverride)
    setPreferences({ ...DEFAULT_PREFERENCES, ...normalizedState.readingPreferences })
    setClassificationSaved(true)
  }

  function sendCommand(command: string, args: Record<string, number> = {}) {
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'command', command, ...args, clientId: 'teleprompter-front' }))
    }
  }

  useEffect(() => {
    let reconnectTimer: number | undefined
    let disposed = false

    function connect() {
      if (disposed) return
      setBackendStatus('connecting')
      const socketUrl = new URL(`/ws/${encodeURIComponent(SESSION_ID)}`, API_URL)
      socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(socketUrl)
      socketRef.current = socket

      socket.onopen = () => {
        welcomeReceivedRef.current = false
        setBackendStatus('connected')
      }
      socket.onmessage = event => {
        let message: { type?: string; state?: RealtimeState }
        try {
          message = JSON.parse(event.data) as typeof message
        } catch {
          console.error('Resposta inválida recebida do backend.')
          return
        }

        if (message.type === 'welcome') {
          welcomeReceivedRef.current = true
          if (localChangesPendingRef.current || !message.state) sendState(socket)
          else applyRemoteState(message.state)
        } else if ((message.type === 'state' || message.type === 'command') && message.state) {
          applyRemoteState(message.state)
        }
      }
      socket.onclose = () => {
        if (socketRef.current === socket) socketRef.current = null
        welcomeReceivedRef.current = false
        if (disposed) return
        setBackendStatus('disconnected')
        reconnectTimer = window.setTimeout(connect, 2000)
      }
      socket.onerror = () => socket.close()
    }

    function sendState(socket: WebSocket) {
      if (socket.readyState === WebSocket.OPEN) {
        if (stateSyncTimerRef.current !== null) {
          window.clearTimeout(stateSyncTimerRef.current)
          stateSyncTimerRef.current = null
        }
        socket.send(JSON.stringify({ type: 'sync', clientId: 'teleprompter-front', state: latestStateRef.current }))
        localChangesPendingRef.current = false
      }
    }

    connect()
    return () => {
      disposed = true
      window.clearTimeout(reconnectTimer)
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [])

  useEffect(() => () => {
    if (scrollSyncTimer.current !== null) window.clearTimeout(scrollSyncTimer.current)
    if (stateSyncTimerRef.current !== null) window.clearTimeout(stateSyncTimerRef.current)
  }, [])

  useEffect(() => {
    const previousState = JSON.stringify(latestStateRef.current)
    const state: RealtimeState = {
      selectedStory,
      pageIndex,
      scrollPosition,
      paused,
      speed,
      fontSize,
      editorialStories,
      operatorOverride,
      readingPreferences: preferences
    }
    const serializedState = JSON.stringify(state)
    if (remoteStateRef.current === serializedState) {
      remoteStateRef.current = null
      latestStateRef.current = state
      localChangesPendingRef.current = false
      return
    }
    if (previousState !== serializedState) localChangesPendingRef.current = true
    latestStateRef.current = state
    const socket = socketRef.current
    if (socket?.readyState === WebSocket.OPEN && welcomeReceivedRef.current) {
      stateSyncTimerRef.current = window.setTimeout(() => {
        stateSyncTimerRef.current = null
        if (socket.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'sync', clientId: 'teleprompter-front', state }))
          localChangesPendingRef.current = false
        } else {
          localChangesPendingRef.current = true
        }
      }, 150)
    }
    return () => {
      if (stateSyncTimerRef.current !== null) {
        window.clearTimeout(stateSyncTimerRef.current)
        stateSyncTimerRef.current = null
      }
    }
  }, [selectedStory, pageIndex, scrollPosition, paused, speed, fontSize, editorialStories, operatorOverride, preferences])

  useEffect(() => {
    try { localStorage.setItem('teleprompter-editorial-stories-v1', JSON.stringify(editorialStories)) } catch { /* classificação permanece nesta sessão */ }
  }, [editorialStories])

  useEffect(() => {
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ preferences, fontSize, speed })) } catch { /* armazenamento indisponível: preferências continuam nesta sessão */ }
  }, [preferences, fontSize, speed])

  useEffect(() => {
    if (tab !== 'Apresentador') return
    function handlePresenterKeys(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target && (target.isContentEditable || ['INPUT', 'SELECT', 'TEXTAREA', 'BUTTON'].includes(target.tagName))) return
      if (event.key === ' ') { event.preventDefault(); toggleReading() }
      else if (event.key === 'ArrowLeft') { event.preventDefault(); previousPage() }
      else if (event.key === 'ArrowRight') { event.preventDefault(); nextPage() }
      else if (event.key === 'ArrowUp') { event.preventDefault(); moveReadingPoint(-220) }
      else if (event.key === 'ArrowDown') { event.preventDefault(); moveReadingPoint(220) }
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); setFontSize(value => Math.min(72, value + 2)) }
      else if (event.key === '-') { event.preventDefault(); setFontSize(value => Math.max(18, value - 2)) }
      else if (event.key === 'Escape') setShowReadingSettings(false)
    }
    window.addEventListener('keydown', handlePresenterKeys)
    return () => window.removeEventListener('keydown', handlePresenterKeys)
  }, [tab, selectedStory, pageIndex, paused, editorialStories])

  function restoreReadingDefaults() {
    setPreferences(DEFAULT_PREFERENCES)
    setFontSize(36)
    setSpeed(1)
    try { localStorage.setItem(PREFERENCES_KEY, JSON.stringify({ preferences: DEFAULT_PREFERENCES, fontSize: 36, speed: 1 })) } catch { /* armazenamento indisponível */ }
  }

  useEffect(() => {
    if (tab !== 'Apresentador' || paused) return
    const timer = window.setInterval(() => {
      const element = presenterTextRef.current
      if (element && element.scrollHeight > element.clientHeight && element.scrollTop + element.clientHeight < element.scrollHeight - 1) {
        element.scrollTop += speed * 0.6
      }
    }, 50)
    return () => window.clearInterval(timer)
  }, [tab, paused, speed, selectedStory, pageIndex])

  useEffect(() => {
    if (tab !== 'Apresentador') return
    const element = presenterTextRef.current
    if (!element) return
    const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
    element.scrollTop = scrollPosition * maxScroll
  }, [tab, selectedStory, pageIndex, scrollPosition, editorialStories])

  const story = editorialStories[selectedStory]
  const nextStory = editorialStories[selectedStory + 1]
  const hasReviewEvent = filter === 'Todas as matérias' || filter === editorialStories[0]?.headline
  const page = story.pages[Math.min(pageIndex, story.pages.length - 1)]
  const totalPages = useMemo(() => editorialStories.reduce((sum, item) => sum + item.pages.length, 0), [editorialStories])
  const previewStories = importStories ?? editorialStories
  const previewPageCount = previewStories.reduce((sum, item) => sum + item.pages.length, 0)
  const globalPage = editorialStories.slice(0, selectedStory).reduce((sum, item) => sum + item.pages.length, 0) + pageIndex + 1
  const progressPercent = totalPages
    ? Math.min(100, ((globalPage - 1 + scrollPosition) / totalPages) * 100)
    : 0

  function takeManualControl() {
    if (liveTranscribingRef.current) stopLiveTranscription()
    sendCommand('take_control')
    setOperatorOverride(true)
    setPaused(true)
  }
  function handlePresenterScroll() {
    if (scrollSyncTimer.current !== null) return
    scrollSyncTimer.current = window.setTimeout(() => {
      scrollSyncTimer.current = null
      const element = presenterTextRef.current
      if (!element) return
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight)
      setScrollPosition(maxScroll ? element.scrollTop / maxScroll : 0)
    }, 120)
  }
  function moveReadingPoint(amount: number) {
    setOperatorOverride(true)
    setPaused(true)
    const element = presenterTextRef.current
    if (!element) return
    element.scrollTop += amount
  }
  function toggleReading() {
    if (liveTranscribingRef.current) stopLiveTranscription()
    setOperatorOverride(true)
    sendCommand(paused ? 'resume' : 'pause')
    setPaused(value => !value)
  }
  function chooseStory(index: number) {
    if (!editorialStories[index]) return
    sendCommand('select_story', { selectedStory: index })
    setSelectedStory(index)
    setPageIndex(0)
    setScrollPosition(0)
    setOperatorOverride(true)
    setPaused(true)
  }
  function choosePage(index: number) {
    if (!story.pages[index]) return
    sendCommand('select_page', { pageIndex: index })
    setPageIndex(index)
    setScrollPosition(0)
    setOperatorOverride(true)
    setPaused(true)
  }
  function updateCurrentStory(patch: Partial<Story>) {
    setEditorialStories(current => current.map((item, index) => index === selectedStory ? { ...item, ...patch } : item))
    setClassificationSaved(false)
  }
  function updateCurrentPage(patch: Partial<Story['pages'][number]>) {
    setEditorialStories(current => current.map((item, index) => index === selectedStory
      ? { ...item, pages: item.pages.map((itemPage, page) => page === pageIndex ? { ...itemPage, ...patch } : itemPage) }
      : item))
    setClassificationSaved(false)
  }
  function saveClassification() {
    try { localStorage.setItem('teleprompter-editorial-stories-v1', JSON.stringify(editorialStories)) } catch { /* classificação permanece nesta sessão */ }
    setClassificationSaved(true)
  }
  function previousPage() {
    sendCommand('previous')
    setOperatorOverride(true)
    setPaused(true)
    if (pageIndex > 0) setPageIndex(pageIndex - 1)
    else if (selectedStory > 0) {
      const previousStory = editorialStories[selectedStory - 1]
      if (previousStory.pages.length > 0) {
        setSelectedStory(selectedStory - 1)
        setPageIndex(previousStory.pages.length - 1)
      }
    }
    setScrollPosition(0)
  }
  function nextPage() {
    sendCommand('next')
    setOperatorOverride(true)
    setPaused(true)
    if (pageIndex < story.pages.length - 1) setPageIndex(pageIndex + 1)
    else if (selectedStory < editorialStories.length - 1) {
      const followingStory = editorialStories[selectedStory + 1]
      if (followingStory.pages.length > 0) {
        setSelectedStory(selectedStory + 1)
        setPageIndex(0)
      }
    }
    setScrollPosition(0)
  }

  async function handleRundownFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const parsed: unknown = JSON.parse(await file.text())
      setImportStories(parseRundownJson(parsed))
      setImportFileName(file.name)
      setImportStatus('Prévia pronta. Confira a ordem e os títulos antes de importar.')
    } catch (error) {
      setImportStories(null)
      setImportFileName('')
      setImportStatus(error instanceof Error ? error.message : 'Não foi possível ler o arquivo JSON.')
    }
  }

  async function importRundown() {
    setImporting(true)
    setImportStatus('')
    try {
      const response = await fetch(`${API_URL}/api/sessions/${encodeURIComponent(SESSION_ID)}/rundown`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ stories: importStories ?? editorialStories })
      })
      const result = await response.json() as {
        detail?: string | Array<{ msg?: string }>
        state?: RealtimeState
        storiesImported?: number
        pagesImported?: number
      }
      if (!response.ok) {
        const detail = Array.isArray(result.detail) ? result.detail.map(issue => issue.msg).filter(Boolean).join('; ') : result.detail
        throw new Error(detail || `Falha na importação (HTTP ${response.status}).`)
      }
      if (result.state) applyRemoteState(result.state)
      setImportStatus(`${result.storiesImported} matérias e ${result.pagesImported} páginas importadas e compartilhadas.`)
      setTab('Operação ao vivo')
    } catch (error) {
      setImportStatus(error instanceof Error ? error.message : 'Falha ao importar o espelho.')
    } finally {
      setImporting(false)
    }
  }

  async function transcribeAudio() {
    if (!audioFile) return
    setTranscribing(true)
    setTranscriptionStatus('')
    try {
      const formData = new FormData()
      formData.append('audio', audioFile)
      const response = await fetch(`${API_URL}/api/transcriptions`, {
        method: 'POST',
        body: formData
      })
      const result = await response.json() as { detail?: string; text?: string }
      if (!response.ok) throw new Error(result.detail || `Falha na transcrição (HTTP ${response.status}).`)
      if (typeof result.text !== 'string') throw new Error('A API retornou uma transcrição inválida.')
      setAudioTranscript(result.text)
      setTranscriptionStatus('Transcrição concluída. Revise o texto antes de aplicá-lo ao roteiro.')
    } catch (error) {
      setTranscriptionStatus(error instanceof Error ? error.message : 'Falha ao transcrever o áudio.')
    } finally {
      setTranscribing(false)
    }
  }

  function currentAlignmentScript() {
    const state = latestStateRef.current
    const currentStory = state.editorialStories[state.selectedStory]
    const currentPage = currentStory?.pages[state.pageIndex]
    if (!currentStory || !currentPage) return null
    return {
      key: `${currentStory.id}:${currentPage.id}`,
      text: [currentStory.headline, currentPage.title, currentPage.text, currentPage.secondary ?? ''].join(' ')
    }
  }

  function updateLiveTranscriptAlignment() {
    const itemIds = [...new Set([...liveItemOrderRef.current, ...Object.keys(liveItemTranscriptsRef.current)])]
    const transcript = itemIds.map(id => liveItemTranscriptsRef.current[id] ?? '').join(' ').trim()
    setLiveTranscript(transcript.slice(-1800))

    const spoken = liveItemTranscriptsRef.current[itemIds.at(-1) ?? '']?.trim()
    const spokenWords = spoken ? getScriptWords(spoken) : []
    if (!spoken) return
    if (spokenWords.length < 4) {
      setLiveSpeechAssessment({
        message: 'Fala reconhecida; aguardando mais palavras para identificar o trecho.',
        kind: 'waiting'
      })
      return
    }
    const speechKey = `${itemIds.at(-1)}:${spoken}`
    if (liveLastEvaluatedSpeechRef.current === speechKey) return
    liveLastEvaluatedSpeechRef.current = speechKey

    const state = latestStateRef.current
    const selectedStory = state.editorialStories[state.selectedStory]
    if (!selectedStory) return

    const makeTarget = (storyIndex: number, targetPageIndex: number) => {
      const targetStory = state.editorialStories[storyIndex]
      const targetPage = targetStory?.pages[targetPageIndex]
      if (!targetStory || !targetPage) return null
      return {
        storyIndex,
        pageIndex: targetPageIndex,
        story: targetStory,
        page: targetPage,
        key: `${targetStory.id}:${targetPage.id}`,
        text: [targetStory.headline, targetPage.title, targetPage.text, targetPage.secondary ?? ''].join(' ')
      }
    }

    const currentTarget = makeTarget(state.selectedStory, state.pageIndex)
    if (!currentTarget) return
    if (alignmentTargetRef.current !== currentTarget.key) {
      alignmentTargetRef.current = currentTarget.key
      alignmentCursorRef.current = Math.floor(
        getScriptWords(currentTarget.text).length * state.scrollPosition
      )
    }

    const currentMatch = findScriptMatch(currentTarget.text, spoken, alignmentCursorRef.current)
      ?? findScriptMatch(currentTarget.text, spoken, 0)
    if (currentMatch && currentMatch.length >= 5) {
      const readCursor = alignmentCursorRef.current
      const repeatedBehindCursor = currentMatch.word < readCursor - 2
      const skippedWords = currentMatch.startWord - readCursor
      if (repeatedBehindCursor) {
        setLiveSpeechAssessment({
          message: `Possível repetição de um trecho já lido · ${selectedStory.headline} · ${currentTarget.page.label}`,
          kind: 'repetition'
        })
      } else {
        alignmentCursorRef.current = currentMatch.word
        setScrollPosition(Math.min(1, currentMatch.word / currentMatch.totalWords))
        if (skippedWords >= 8) {
          setLiveSpeechAssessment({
            message: `Possível omissão de cerca de ${skippedWords} palavras; retomei no trecho reconhecido · ${selectedStory.headline}`,
            kind: 'omission'
          })
        } else {
          setLiveSpeechAssessment({
            message: `Acompanhando o roteiro · ${selectedStory.headline} · ${currentTarget.page.label}`,
            kind: 'match'
          })
        }
      }
      return
    }

    for (let previousPageIndex = 0; previousPageIndex < state.pageIndex; previousPageIndex++) {
      const target = makeTarget(state.selectedStory, previousPageIndex)
      const match = target && findScriptMatch(target.text, spoken, 0)
      if (!target || !match || match.length < 5) continue
      setPageIndex(target.pageIndex)
      setScrollPosition(Math.min(1, match.word / match.totalWords))
      alignmentTargetRef.current = target.key
      alignmentCursorRef.current = match.word
      setLiveSpeechAssessment({
        message: `Retomada identificada · ${selectedStory.headline} · ${target.page.label}`,
        kind: 'resumption'
      })
      return
    }

    for (let nextPageIndex = state.pageIndex + 1; nextPageIndex < selectedStory.pages.length; nextPageIndex++) {
      const target = makeTarget(state.selectedStory, nextPageIndex)
      const match = target && findScriptMatch(target.text, spoken, 0)
      if (!target || !match || match.length < 5) continue
      setPageIndex(target.pageIndex)
      setScrollPosition(Math.min(1, match.word / match.totalWords))
      alignmentTargetRef.current = target.key
      alignmentCursorRef.current = match.word
      setLiveSpeechAssessment({
        message: `Continuação identificada · ${selectedStory.headline} · ${target.page.label}`,
        kind: 'match'
      })
      return
    }

    let otherStoryMatch: {
      storyIndex: number
      pageIndex: number
      story: Story
      page: Story['pages'][number]
      key: string
      match: NonNullable<ReturnType<typeof findScriptMatch>>
    } | null = null
    for (let storyIndex = 0; storyIndex < state.editorialStories.length; storyIndex++) {
      if (storyIndex === state.selectedStory) continue
      const otherStory = state.editorialStories[storyIndex]
      for (let targetPageIndex = 0; targetPageIndex < otherStory.pages.length; targetPageIndex++) {
        const target = makeTarget(storyIndex, targetPageIndex)
        const match = target && findScriptMatch(target.text, spoken, 0)
        if (target && match && match.length >= 6 && (!otherStoryMatch || match.length > otherStoryMatch.match.length)) {
          otherStoryMatch = { ...target, match }
        }
      }
    }
    if (otherStoryMatch) {
      setSelectedStory(otherStoryMatch.storyIndex)
      setPageIndex(otherStoryMatch.pageIndex)
      setScrollPosition(Math.min(1, otherStoryMatch.match.word / otherStoryMatch.match.totalWords))
      setOperatorOverride(true)
      alignmentTargetRef.current = otherStoryMatch.key
      alignmentCursorRef.current = otherStoryMatch.match.word
      setLiveSpeechAssessment({
        message: `Outro roteiro identificado e selecionado · ${otherStoryMatch.story.headline} · ${otherStoryMatch.page.label}`,
        kind: 'match'
      })
      return
    }

    if (currentMatch) {
      alignmentCursorRef.current = currentMatch.word
      setScrollPosition(Math.min(1, currentMatch.word / currentMatch.totalWords))
      setLiveSpeechAssessment({
        message: `Trecho compatível com o roteiro selecionado · ${selectedStory.headline} · ${currentTarget.page.label}`,
        kind: 'match'
      })
      return
    }

    setLiveSpeechAssessment({
      message: spokenWords.length >= 5
        ? 'Fala fora dos roteiros carregados · possível improviso'
        : 'Fala reconhecida; aguardando mais palavras para identificar o trecho.',
      kind: spokenWords.length >= 5 ? 'improviso' : 'waiting'
    })
  }

  function closeLiveSocketAfterFinalTranscription() {
    if (
      liveTranscribingRef.current ||
      !liveFinalizingRef.current ||
      liveStopWaitingForCommitRef.current ||
      livePendingItemIdsRef.current.size > 0
    ) return
    if (liveStopTimerRef.current !== null) {
      window.clearTimeout(liveStopTimerRef.current)
      liveStopTimerRef.current = null
    }
    liveTranscriptionSocketRef.current?.close()
  }

  function setupLiveAudioCapture() {
    const stream = liveAudioStreamRef.current
    const audioContext = liveAudioContextRef.current
    const socket = liveTranscriptionSocketRef.current
    if (!stream || !audioContext || !socket || liveAudioProcessorRef.current) return

    const source = audioContext.createMediaStreamSource(stream)
    const processor = audioContext.createScriptProcessor(4096, 1, 1)
    const silentGain = audioContext.createGain()
    silentGain.gain.value = 0
    processor.onaudioprocess = event => {
      const input = event.inputBuffer.getChannelData(0)
      const output = event.outputBuffer.getChannelData(0)
      output.fill(0)

      if (!liveTranscribingRef.current || !liveTranscriptionReadyRef.current || socket.readyState !== WebSocket.OPEN) return
      const encoded = encodePcm16Base64(input, audioContext.sampleRate)
      if (!encoded.audio) return

      let sumSquares = 0
      for (let index = 0; index < input.length; index++) sumSquares += input[index] * input[index]
      const inputLevel = Math.sqrt(sumSquares / input.length)
      const hasVoice = inputLevel >= 0.012
      const now = performance.now()
      if (now - liveAudioLevelUpdateAtRef.current >= 200) {
        liveAudioLevelUpdateAtRef.current = now
        setLiveInputLevel(Math.min(100, Math.round(inputLevel * 500)))
      }

      if (hasVoice) {
        if (!liveTurnHasSpeechRef.current) {
          for (const chunk of livePreRollChunksRef.current) {
            socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: chunk.audio }))
            liveSamplesInTurnRef.current += chunk.samples
          }
          livePreRollChunksRef.current = []
          livePreRollSamplesRef.current = 0
        }
        liveTurnHasSpeechRef.current = true
        liveSilenceSamplesRef.current = 0
        socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: encoded.audio }))
        liveSamplesInTurnRef.current += encoded.samples
      } else if (liveTurnHasSpeechRef.current) {
        socket.send(JSON.stringify({ type: 'input_audio_buffer.append', audio: encoded.audio }))
        liveSamplesInTurnRef.current += encoded.samples
        liveSilenceSamplesRef.current += encoded.samples
      } else {
        livePreRollChunksRef.current.push(encoded)
        livePreRollSamplesRef.current += encoded.samples
        while (livePreRollSamplesRef.current > LIVE_AUDIO_SAMPLE_RATE * 0.3) {
          const removed = livePreRollChunksRef.current.shift()
          if (!removed) break
          livePreRollSamplesRef.current -= removed.samples
        }
      }

      const reachedSpeechPause = liveTurnHasSpeechRef.current &&
        liveSilenceSamplesRef.current >= LIVE_AUDIO_SAMPLE_RATE * 0.8
      const reachedProgressInterval = liveSamplesInTurnRef.current >=
        LIVE_AUDIO_SAMPLE_RATE * LIVE_AUDIO_MAX_SEGMENT_SECONDS
      if (reachedSpeechPause || reachedProgressInterval) {
        socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
        liveSamplesInTurnRef.current = 0
        liveSilenceSamplesRef.current = 0
        liveTurnHasSpeechRef.current = false
        livePreRollChunksRef.current = []
        livePreRollSamplesRef.current = 0
      }
    }

    source.connect(processor)
    processor.connect(silentGain)
    silentGain.connect(audioContext.destination)
    liveAudioSourceRef.current = source
    liveAudioProcessorRef.current = processor
    liveAudioGainRef.current = silentGain
    liveTranscriptionReadyRef.current = true
    setLiveTranscriptionStatus(`Microfone ativo. O ponto do roteiro atualiza por trechos de até ${LIVE_AUDIO_MAX_SEGMENT_SECONDS} segundos, sem desligar o microfone.`)
  }

  function releaseLiveAudio() {
    liveTranscriptionReadyRef.current = false
    const processor = liveAudioProcessorRef.current
    if (processor) {
      processor.onaudioprocess = null
      processor.disconnect()
      liveAudioProcessorRef.current = null
    }
    liveAudioSourceRef.current?.disconnect()
    liveAudioSourceRef.current = null
    liveAudioGainRef.current?.disconnect()
    liveAudioGainRef.current = null
    liveAudioStreamRef.current?.getTracks().forEach(track => track.stop())
    liveAudioStreamRef.current = null
    setLiveInputLevel(0)
    const audioContext = liveAudioContextRef.current
    liveAudioContextRef.current = null
    if (audioContext && audioContext.state !== 'closed') {
      void audioContext.close().catch(error => console.error('Falha ao encerrar o áudio em tempo real.', error))
    }
  }

  async function startLiveTranscription() {
    if (liveTranscribingRef.current) return
    if (liveFinalizing) {
      setLiveTranscriptionStatus('Aguardando a última transcrição ser concluída.')
      return
    }
    if (recording || transcribing) {
      setLiveTranscriptionStatus('Encerre a gravação ou transcrição de arquivo antes de iniciar o acompanhamento ao vivo.')
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || typeof AudioContext === 'undefined') {
      setLiveTranscriptionStatus('Este navegador não oferece captura de áudio. Tente uma versão atualizada em HTTPS ou localhost.')
      return
    }

    liveTranscribingRef.current = true
    setLiveTranscribing(true)
    setLiveTranscript('')
    setLiveInputLevel(0)
    setLiveTranscriptionStatus('Aguardando permissão do microfone…')
    liveItemOrderRef.current = []
    liveItemTranscriptsRef.current = {}
    liveLastEvaluatedSpeechRef.current = ''
    setLiveSpeechAssessment({
      message: 'Microfone conectado. Aguardando a primeira fala…',
      kind: 'waiting'
    })
    livePendingItemIdsRef.current.clear()
    liveCompletedItemIdsRef.current.clear()
    liveStopWaitingForCommitRef.current = false
    liveFinalizingRef.current = false
    setLiveFinalizing(false)
    liveSamplesInTurnRef.current = 0
    liveSilenceSamplesRef.current = 0
    liveTurnHasSpeechRef.current = false
    livePreRollChunksRef.current = []
    livePreRollSamplesRef.current = 0
    alignmentTargetRef.current = ''
    alignmentCursorRef.current = 0
    if (liveStopTimerRef.current !== null) {
      window.clearTimeout(liveStopTimerRef.current)
      liveStopTimerRef.current = null
    }

    try {
      let audioContext: AudioContext
      try {
        audioContext = new AudioContext({ sampleRate: LIVE_AUDIO_SAMPLE_RATE })
      } catch {
        audioContext = new AudioContext()
      }
      liveAudioContextRef.current = audioContext
      void audioContext.resume().catch(error => console.error('Não foi possível iniciar o áudio do microfone.', error))
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (!liveTranscribingRef.current) {
        stream.getTracks().forEach(track => track.stop())
        return
      }
      liveAudioStreamRef.current = stream
      if (audioContext.state !== 'running') await audioContext.resume()
      if (!liveTranscribingRef.current) {
        releaseLiveAudio()
        return
      }

      const socketUrl = new URL(`/ws/${encodeURIComponent(SESSION_ID)}/transcription`, API_URL)
      socketUrl.protocol = socketUrl.protocol === 'https:' ? 'wss:' : 'ws:'
      const socket = new WebSocket(socketUrl)
      liveTranscriptionSocketRef.current = socket
      socket.onopen = () => setLiveTranscriptionStatus('Conectado. Preparando a transcrição em tempo real…')
      socket.onmessage = event => {
        if (liveTranscriptionSocketRef.current !== socket) return
        let message: {
          type?: string
          item_id?: string
          delta?: string
          transcript?: string
          message?: string
          error?: { message?: string }
        }
        try {
          message = JSON.parse(event.data) as typeof message
        } catch {
          setLiveTranscriptionStatus('O backend enviou um evento de transcrição inválido.')
          return
        }

        if (message.type === 'session.updated' || message.type === 'transcription_session.updated') {
          if (liveTranscriptionReadyRef.current) return
          try {
            const currentScript = currentAlignmentScript()
            if (currentScript) {
              alignmentTargetRef.current = currentScript.key
              alignmentCursorRef.current = Math.floor(getScriptWords(currentScript.text).length * latestStateRef.current.scrollPosition)
            }
            setPaused(true)
            setOperatorOverride(true)
            sendCommand('pause')
            setupLiveAudioCapture()
          } catch (error) {
            setLiveTranscriptionStatus(error instanceof Error ? error.message : 'Não foi possível iniciar a captura de áudio.')
            stopLiveTranscription()
          }
        } else if (message.type === 'input_audio_buffer.committed' && message.item_id) {
          setLiveTranscriptionStatus('Trecho enviado para transcrição; o microfone continua ativo.')
          if (!liveItemOrderRef.current.includes(message.item_id)) liveItemOrderRef.current.push(message.item_id)
          if (!liveCompletedItemIdsRef.current.has(message.item_id)) livePendingItemIdsRef.current.add(message.item_id)
          if (liveStopWaitingForCommitRef.current) liveStopWaitingForCommitRef.current = false
          closeLiveSocketAfterFinalTranscription()
        } else if (message.type === 'transcription.started') {
          setLiveTranscriptionStatus(
            message.message || 'Trecho recebido. Transcrevendo localmente; aguarde o resultado…'
          )
        } else if (message.type === 'conversation.item.input_audio_transcription.delta' && message.item_id && message.delta) {
          liveItemTranscriptsRef.current[message.item_id] =
            (liveItemTranscriptsRef.current[message.item_id] ?? '') + message.delta
          updateLiveTranscriptAlignment()
        } else if (message.type === 'conversation.item.input_audio_transcription.completed' && message.item_id && typeof message.transcript === 'string') {
          liveItemTranscriptsRef.current[message.item_id] = message.transcript
          setLiveTranscriptionStatus(
            message.transcript.trim()
              ? 'Transcrição recebida; acompanhando o ponto do roteiro.'
              : 'Trecho processado sem fala reconhecível. Confira o nível do microfone e tente falar mais perto.'
          )
          liveCompletedItemIdsRef.current.add(message.item_id)
          livePendingItemIdsRef.current.delete(message.item_id)
          if (!liveItemOrderRef.current.includes(message.item_id)) liveItemOrderRef.current.push(message.item_id)
          while (liveItemOrderRef.current.length > 20) {
            const oldestId = liveItemOrderRef.current.shift()
            if (oldestId) {
              delete liveItemTranscriptsRef.current[oldestId]
              liveCompletedItemIdsRef.current.delete(oldestId)
            }
          }
          updateLiveTranscriptAlignment()
          closeLiveSocketAfterFinalTranscription()
        } else if (message.type === 'error') {
          const errorMessage = message.error?.message ?? message.message
          setLiveTranscriptionStatus(errorMessage || 'O serviço local de transcrição retornou um erro.')
          liveTranscribingRef.current = false
          liveFinalizingRef.current = false
          setLiveTranscribing(false)
          setLiveFinalizing(false)
          releaseLiveAudio()
          socket.close()
        }
      }
      socket.onerror = () => setLiveTranscriptionStatus('Falha na conexão com o serviço de transcrição.')
      socket.onclose = () => {
        if (liveTranscriptionSocketRef.current !== socket) return
        const wasActive = liveTranscribingRef.current
        liveTranscriptionSocketRef.current = null
        releaseLiveAudio()
        liveTranscribingRef.current = false
        liveFinalizingRef.current = false
        setLiveTranscribing(false)
        setLiveFinalizing(false)
        if (wasActive) setLiveTranscriptionStatus('A conexão foi encerrada. Inicie novamente para continuar o acompanhamento.')
      }
    } catch (error) {
      liveTranscribingRef.current = false
      liveFinalizingRef.current = false
      setLiveTranscribing(false)
      setLiveFinalizing(false)
      releaseLiveAudio()
      liveTranscriptionSocketRef.current?.close()
      liveTranscriptionSocketRef.current = null
      const message = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Acesso ao microfone negado. Permita o uso do microfone nas configurações do navegador.'
        : error instanceof Error ? error.message : 'Não foi possível iniciar a transcrição em tempo real.'
      setLiveTranscriptionStatus(message)
    }
  }

  function stopLiveTranscription() {
    if (!liveTranscribingRef.current) return
    liveTranscribingRef.current = false
    setLiveTranscribing(false)
    const socket = liveTranscriptionSocketRef.current
    const hasAudioToCommit = liveTurnHasSpeechRef.current && liveSamplesInTurnRef.current > 0
    const shouldWaitForFinalTranscription = hasAudioToCommit || livePendingItemIdsRef.current.size > 0
    liveFinalizingRef.current = shouldWaitForFinalTranscription
    liveStopWaitingForCommitRef.current = hasAudioToCommit
    setLiveFinalizing(shouldWaitForFinalTranscription)
    if (hasAudioToCommit && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify({ type: 'input_audio_buffer.commit' }))
    }
    liveSamplesInTurnRef.current = 0
    liveTurnHasSpeechRef.current = false
    livePreRollChunksRef.current = []
    livePreRollSamplesRef.current = 0
    releaseLiveAudio()
    setLiveTranscriptionStatus(shouldWaitForFinalTranscription
      ? 'Microfone encerrado. Aguardando a transcrição local; o primeiro trecho pode demorar…'
      : 'Acompanhamento encerrado.')
    if (liveStopTimerRef.current !== null) window.clearTimeout(liveStopTimerRef.current)
    liveStopTimerRef.current = window.setTimeout(() => {
      liveTranscriptionSocketRef.current?.close()
      liveStopTimerRef.current = null
    }, shouldWaitForFinalTranscription ? 180_000 : 0)
  }

  async function startAudioRecording() {
    if (liveTranscribingRef.current) {
      setTranscriptionStatus('Encerre o acompanhamento ao vivo antes de gravar um arquivo.')
      return
    }
    if (typeof MediaRecorder === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setTranscriptionStatus('Este navegador não oferece gravação de áudio. Tente uma versão atualizada em HTTPS ou localhost.')
      return
    }

    let stream: MediaStream | null = null
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const supportedMimeType = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
        .find(mimeType => MediaRecorder.isTypeSupported(mimeType))
      const recorder = supportedMimeType
        ? new MediaRecorder(stream, { mimeType: supportedMimeType })
        : new MediaRecorder(stream)
      const recordingMimeType = recorder.mimeType.toLowerCase()
      if (!recordingMimeType.startsWith('audio/webm') && !recordingMimeType.startsWith('audio/mp4')) {
        stream.getTracks().forEach(track => track.stop())
        setTranscriptionStatus('Este navegador grava em um formato não compatível. Use Chrome, Edge ou Safari atualizado.')
        return
      }

      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder
      recordingChunksRef.current = []
      setAudioFile(null)
      setAudioTranscript('')
      setTranscriptionStatus('Gravando pelo microfone…')

      recorder.ondataavailable = event => {
        if (event.data.size > 0) recordingChunksRef.current.push(event.data)
      }
      recorder.onerror = () => {
        recorder.onstop = null
        mediaStreamRef.current?.getTracks().forEach(track => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        setRecording(false)
        setTranscriptionStatus('Não foi possível gravar o áudio. Verifique o microfone e tente novamente.')
      }
      recorder.onstop = () => {
        const mimeType = recorder.mimeType || recordingChunksRef.current[0]?.type || 'audio/webm'
        const extension = mimeType.includes('mp4') ? 'mp4' : 'webm'
        const recordingFile = new File(
          recordingChunksRef.current,
          `gravacao-microfone.${extension}`,
          { type: mimeType }
        )
        mediaStreamRef.current?.getTracks().forEach(track => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        setRecording(false)
        if (recordingFile.size === 0) {
          setTranscriptionStatus('Nenhum áudio foi capturado. Grave novamente e fale próximo ao microfone.')
          return
        }
        if (recordingFile.size > 25 * 1024 * 1024) {
          setTranscriptionStatus('A gravação excede o limite de 25 MB. Faça uma gravação mais curta.')
          return
        }
        setAudioFile(recordingFile)
        setTranscriptionStatus('Gravação concluída. Envie-a para transcrição.')
      }
      recorder.start()
      setRecording(true)
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
      mediaRecorderRef.current = null
      const message = error instanceof DOMException && error.name === 'NotAllowedError'
        ? 'Acesso ao microfone negado. Permita o uso do microfone nas configurações do navegador.'
        : error instanceof Error ? error.message : 'Não foi possível acessar o microfone.'
      setTranscriptionStatus(message)
    }
  }

  function stopAudioRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
      setTranscriptionStatus('Finalizando a gravação…')
    }
  }

  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">T</div><div><strong>Teleprompter</strong><span>Console do operador</span></div></div>
      <div className="top-meta"><span className="environment">SESSÃO · {SESSION_ID}</span><span className={`connection ${backendStatus === 'connected' ? 'online' : ''}`}>● API · {backendStatus === 'connected' ? 'conectada' : backendStatus === 'connecting' ? 'conectando' : 'desconectada'}</span><strong>19:07:12</strong><span className="avatar">MC</span></div>
    </header>

    <nav className="tabs" aria-label="Navegação principal">
      {(['Preparar roteiro', 'Editor de roteiro', 'Operação ao vivo', 'Leitura ampliada', 'Apresentador'] as Tab[]).map(item =>
        <button key={item} className={`tab ${tab === item ? 'active' : ''}`} aria-current={tab === item ? 'page' : undefined} onClick={() => setTab(item)}>
          {item === 'Apresentador' ? 'Teleprompter' : item}{item === 'Improvisos' && <span className="tab-count">1</span>}
        </button>)}
      <div className="station">Estúdio A / Mariana Costa</div>
    </nav>

    {tab === 'Preparar roteiro' && <main className="page-wrap">
      <div className="page-title"><div><p className="eyebrow">CONFIGURAÇÃO E IMPORTAÇÃO</p><h1>Preparar a operação</h1><p>Revise o arquivo do espelho antes de compartilhá-lo com as telas conectadas à sessão.</p></div><span className="date-label">Sessão · {SESSION_ID}</span></div>
      <div className="setup-grid">
        <section className="panel connection-panel"><h3>Preparar roteiro</h3>
          <div className="notice">Importação por arquivo<p>Este produto não se conecta a sistemas editoriais externos. Use um arquivo JSON para carregar o espelho e revisar a prévia antes de compartilhar o roteiro com a sessão.</p></div>
          <label>Carregar arquivo do espelho (.json)<input type="file" accept=".json,application/json" onChange={event => void handleRundownFileChange(event)} /></label>
          <p className="tiny muted">Aceita um array de matérias ou um objeto com a propriedade <code>stories</code>. Títulos, sequência, páginas e campos editoriais são preservados.</p>
          {importFileName && <p className="tiny muted">Arquivo: {importFileName}</p>}
          {importStatus && <div className={`notice ${importStatus.includes('importadas') || importStatus.includes('Prévia pronta') ? 'success' : 'warning'}`} role="status">{importStatus}</div>}
        </section>
        <section className="panel import-panel"><div className="panel-heading"><h3>Prévia do espelho</h3><span className="tiny muted">{importStories ? 'ARQUIVO SELECIONADO' : 'ROTEIRO ATUAL'}</span></div>
          <div className="table-heading"><div><h3>Matérias e ordem de leitura</h3><p className="muted">{previewStories.length} matérias · {previewPageCount} páginas</p></div></div>
          <div className="data-table"><div className="table-row table-head"><span>ID</span><span>MATÉRIA</span><span>CATEGORIA</span><span>PÁGINAS</span></div>{previewStories.map(s => <div className="table-row" key={s.id}><span>{s.code}</span><span>{s.headline}</span><span>{s.category}</span><span>{s.pages.length}</span></div>)}</div>
          <div className="import-bottom"><span className="success-text">✓ {previewPageCount} páginas na prévia</span><button className="primary" disabled={importing} onClick={() => void importRundown()}>{importing ? 'Importando…' : '↓ Importar espelho e abrir operação'}</button></div>
        </section>
      </div>
    </main>}

    {tab === 'Editor de roteiro' && <main className="page-wrap">
      <div className="page-title"><div><p className="eyebrow">EDIÇÃO DO ROTEIRO</p><h1>Editor de roteiro</h1><p>As alterações são salvas e sincronizadas com as telas da sessão em tempo real.</p></div><span className="date-label">{backendStatus === 'connected' ? 'Sincronização ativa' : 'Modo manual · aguardando conexão'}</span></div>
      <div className="script-editor-layout">
        <section className="panel script-editor-main">
          <div className="script-editor-title">
            <label>Retranca / título da matéria<input aria-label="Título da matéria" value={story.headline} onChange={event => updateCurrentStory({ headline: event.target.value })} /></label>
            <label>Código<input aria-label="Código da matéria" value={story.code} onChange={event => updateCurrentStory({ code: event.target.value })} /></label>
          </div>
          <div className="script-editor-title">
            <label>Retranca da página<input aria-label="Retranca da página" value={page.title} onChange={event => updateCurrentPage({ title: event.target.value })} /></label>
            <label>Identificação editorial<input aria-label="Identificação editorial da página" value={page.label} onChange={event => updateCurrentPage({ label: event.target.value })} /></label>
          </div>
          <ScriptEditor
            label="Texto do roteiro"
            html={page.bodyHtml}
            text={page.text}
            onChange={(html, text) => updateCurrentPage({ bodyHtml: html, text })}
          />
          <ScriptEditor
            label="Texto complementar"
            html={page.secondaryHtml}
            text={page.secondary ?? ''}
            onChange={(html, text) => updateCurrentPage({ secondaryHtml: html, secondary: text })}
          />
          <div className="script-editor-toolbar">
            <button className="secondary" onClick={() => setTab('Apresentador')}>Abrir tela do TP</button>
            <span className="muted">{backendStatus === 'connected' ? '● Alterações sincronizadas' : '● Alterações mantidas localmente até reconectar'}</span>
          </div>
        </section>
        <aside className="panel script-editor-sidebar">
          <div className="panel-heading"><h3>Matérias</h3><span className="tiny muted">{editorialStories.length}</span></div>
          <div className="rundown-list">{editorialStories.map((item, index) =>
            <button key={item.id} className={`rundown-item ${selectedStory === index ? 'selected' : ''}`} aria-pressed={selectedStory === index} onClick={() => chooseStory(index)}>
              <span className="rundown-code">{item.code}</span><span className="rundown-copy"><strong>{item.headline}</strong><small>{item.pages.length} página(s)</small></span>
            </button>)}
          </div>
          <div className="panel-heading"><h3>Páginas</h3><span className="tiny muted">{story.pages.length}</span></div>
          <div className="editor-page-list">{story.pages.map((item, index) =>
            <button key={item.id} aria-pressed={pageIndex === index} onClick={() => choosePage(index)}>{index + 1}. {item.title}</button>)}
          </div>
          <p className="tiny muted">Marca-texto indica ênfase. Sublinhado azul identifica nota coberta. As marcações são preservadas na tela do apresentador.</p>
        </aside>
      </div>
    </main>}

    {tab === 'Operação ao vivo' && <main className="page-wrap">
      <div className="page-title"><div><p className="eyebrow">ACOMPANHAMENTO DA LEITURA</p><h1>Operação ao vivo</h1><p>Edite o roteiro, escolha a matéria e controle manualmente a leitura.</p></div><div className="edition"><strong>Jornal da Noite</strong><span>05 out. 2026 · 19:00–19:30 · Espelho v12</span></div></div>
      <div className="live-grid">
        <aside className="panel rundown"><div className="panel-heading"><h3>Espelho do jornal</h3><span className="pill green">● Sincronizado · v12</span></div><p className="tiny muted">Bloco A · {editorialStories.length} matérias · {totalPages} páginas</p>
          <div className="rundown-list">{editorialStories.map((s, i) => <button key={s.id} className={`rundown-item ${selectedStory === i ? 'selected' : ''}`} aria-pressed={selectedStory === i} onClick={() => chooseStory(i)}><span className="rundown-code">{s.code}</span><span className="rundown-copy"><strong>{s.headline}</strong><small>{s.category} · {s.pages.length} pág.</small>{(s.alertLevel === 'critical' || s.alertLevel === 'attention') && <em className={`rundown-alert ${s.alertLevel}`}>{s.alertLevel === 'critical' ? 'Alerta importante' : 'Atenção editorial'}</em>}</span>{selectedStory === i && <span className="now">No ar</span>}</button>)}</div>
        </aside>
        <section className="panel prompter-panel">
          <div className="prompter-head"><div><span className="pill green">● No ar · {story.code}</span><span className="pill editorial-category">{story.category} · Tom {story.tone}</span><strong>{story.headline}</strong><small>{story.pages.length} página(s) · Roteiro v12</small></div><div className="operator-page-picker"><label>Página atual<select aria-label="Selecionar página da matéria" value={pageIndex} onChange={e => choosePage(Number(e.target.value))}>{story.pages.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.title}</option>)}</select></label><div className="page-count">Página {pageIndex + 1} de {story.pages.length}<br/><span>Página geral {globalPage}/{totalPages}</span></div></div></div>
          <div className="script-area">
            <div className="script-label">{page.label} <span>· {story.category.toUpperCase()} · TOM {story.tone.toUpperCase()}</span></div>
            {(story.alertLevel === 'critical' || story.alertLevel === 'attention') && <div className={`editorial-alert compact ${story.alertLevel}`}><strong>{story.category} · {story.tone}</strong><p>{story.guidance}</p></div>}
            <div className="retranque" style={{ fontSize: `${fontSize}px` }}>{story.headline} · {page.title}</div>
            <div style={{ fontSize: `${fontSize}px` }}><ScriptText className="script-content" html={page.bodyHtml} text={page.text} /></div>
            {page.secondary && <div style={{ fontSize: `${fontSize}px` }}><ScriptText className="script-content" html={page.secondaryHtml} text={page.secondary} /></div>}
            <span className="script-keywords">Palavras-chave: {page.keywords.join(' · ')}</span>
          </div>
          <div className="prompter-footer"><span>Linha {String(pageIndex + 4).padStart(2, '0')} de {String(totalPages * 3).padStart(2, '0')}</span><div className="progress"><span style={{width: `${progressPercent}%`}} /></div><span>00:24 / 02:30</span><button className="secondary small" onClick={() => setShowExpanded(true)}>↗ Ampliar</button></div>
        </section>
        <aside className="panel voice-panel">
          <h3>Transcrição de áudio</h3>
          <p className="muted">Compara os trechos reconhecidos ao roteiro e sinaliza possíveis omissões, repetições, retomadas e improvisos.</p>
          <div className="audio-record-controls">
            <button className="primary full" disabled={liveTranscribing || liveFinalizing} onClick={() => void startLiveTranscription()}>{liveTranscribing ? 'Microfone acompanhando o roteiro' : liveFinalizing ? 'Finalizando transcrição…' : 'Iniciar acompanhamento ao vivo'}</button>
            <button className="secondary full" disabled={!liveTranscribing} onClick={stopLiveTranscription}>Parar acompanhamento</button>
          </div>
          {liveTranscriptionStatus && <p className="transcription-status" role="status" aria-live="polite">{liveTranscriptionStatus}</p>}
          {liveTranscript && <div className="live-transcript-preview">{liveTranscript}</div>}
          <div className="audio-record-controls">
            <button className="primary full" disabled={recording || transcribing || liveTranscribing} onClick={() => void startAudioRecording()}>{recording ? 'Gravando pelo microfone…' : 'Gravar para transcrever depois'}</button>
            <button className="secondary full" disabled={!recording || transcribing} onClick={stopAudioRecording}>Encerrar gravação</button>
          </div>
          <label className="audio-upload">Arquivo de áudio<input type="file" accept=".mp3,.mp4,.mpeg,.mpga,.m4a,.wav,.webm" disabled={recording || transcribing || liveTranscribing} onChange={event => {
            const selectedFile = event.target.files?.[0] ?? null
            if (selectedFile && selectedFile.size > 25 * 1024 * 1024) {
              setAudioFile(null)
              setTranscriptionStatus('O arquivo de áudio excede o limite de 25 MB.')
              event.target.value = ''
              return
            }
            setAudioFile(selectedFile)
            setTranscriptionStatus('')
          }} /></label>
          <p className="tiny muted">MP3, MP4, MPEG, MPGA, M4A, WAV ou WEBM · máximo 25 MB</p>
          <button className="primary full" disabled={!audioFile || recording || transcribing || liveTranscribing} onClick={() => void transcribeAudio()}>{transcribing ? 'Transcrevendo…' : 'Enviar áudio e transcrever'}</button>
          {transcriptionStatus && <p className="transcription-status" role="status" aria-live="polite">{transcriptionStatus}</p>}
          {audioTranscript && <div className="audio-transcript">
            <label>Texto transcrito<textarea value={audioTranscript} onChange={event => setAudioTranscript(event.target.value)} rows={6} /></label>
            <button className="secondary full" onClick={() => updateCurrentPage({ text: audioTranscript, bodyHtml: undefined })}>Usar no texto da página atual</button>
          </div>}
          <button className="secondary full" onClick={() => setTab('Editor de roteiro')}>Abrir editor</button>
        </aside>
      </div>
      <section className="panel editorial-panel">
        <div className="panel-heading"><div><p className="eyebrow">IDENTIFICAÇÃO EDITORIAL</p><h3>Classificação da matéria selecionada</h3></div></div>
        <div className="editorial-current"><div className={`editorial-alert ${story.alertLevel || 'none'}`}><strong>{story.alertLevel === 'critical' ? 'ALERTA EDITORIAL IMPORTANTE' : story.alertLevel === 'attention' ? 'ATENÇÃO EDITORIAL' : 'ORIENTAÇÃO EDITORIAL'}</strong><p>{story.guidance || 'Revise a chamada e o tom antes de iniciar a leitura.'}</p></div><div className="next-story-preview"><span className="tiny muted">PRÓXIMA MATÉRIA · PRÉVIA</span>{nextStory ? <><strong>{nextStory.headline}</strong><span>{nextStory.category} · Tom: {nextStory.tone}</span><p>{nextStory.pages[0]?.text}</p></> : <strong className="next-story-empty">Fim do espelho</strong>}</div></div>
        <details className="editorial-review"><summary><span>Editar chamada e classificação</span><span className={`pill ${classificationSaved ? 'green' : 'yellow'}`}>{classificationSaved ? 'Classificação salva' : 'Alterações não salvas'}</span></summary><div className="editorial-form">
          <label>Chamada / título descritivo<input value={story.headline} onChange={e => updateCurrentStory({ headline: e.target.value })} /></label>
          <label>Categoria editorial<select value={story.category} onChange={e => { const category = e.target.value as Story['category']; const defaults: Record<string, {tone:string; guidance:string; alertLevel:'none'|'attention'|'critical'}> = { 'Notícia séria': {tone:'Sóbrio',guidance:'Manter expressão séria, ritmo estável e linguagem respeitosa.',alertLevel:'attention'}, 'Falecimento': {tone:'Sóbrio e respeitoso',guidance:'Notícia de falecimento: evitar sorriso e tom celebratório. Manter postura respeitosa.',alertLevel:'critical'}, 'Política': {tone:'Informativo e neutro',guidance:'Manter neutralidade e separar fatos de opiniões.',alertLevel:'attention'}, 'Previsão do tempo': {tone:'Natural e informativo',guidance:'Tom acessível, sem exagerar a expressividade.',alertLevel:'none'}, 'Conteúdo leve': {tone:'Leve',guidance:'Tom natural e acolhedor, adequado ao conteúdo.',alertLevel:'none'}, 'Cidade': {tone:'Informativo',guidance:'Destacar o impacto do assunto para a população.',alertLevel:'none'}, 'Economia': {tone:'Objetivo',guidance:'Dar atenção aos números e aos seus impactos.',alertLevel:'none'}, 'Cultura': {tone:'Informativo',guidance:'Apresentar contexto e relevância cultural.',alertLevel:'none'} }; updateCurrentStory({ category, ...(defaults[category] || {}) }) }}><option>Notícia séria</option><option>Falecimento</option><option>Política</option><option>Previsão do tempo</option><option>Conteúdo leve</option><option>Cidade</option><option>Economia</option><option>Cultura</option></select></label>
          <label>Tom editorial definido pelo operador<input value={story.tone} onChange={e => updateCurrentStory({ tone: e.target.value })} placeholder="Ex.: sóbrio, neutro, acolhedor" /></label>
          <label>Nível de alerta<select value={story.alertLevel || 'none'} onChange={e => updateCurrentStory({ alertLevel: e.target.value as Story['alertLevel'] })}><option value="none">Sem alerta</option><option value="attention">Atenção editorial</option><option value="critical">Alerta importante</option></select></label>
          <label className="editorial-guidance">Orientação para o apresentador<textarea value={story.guidance} onChange={e => updateCurrentStory({ guidance: e.target.value })} rows={2} /></label>
        </div>
        <div className="editorial-actions"><span className="tiny muted">A classificação é manual e fica salva neste navegador.</span><button className="primary" onClick={saveClassification}>Salvar classificação</button></div></details>
      </section>
      <div className="control-bar"><div className="transport"><button className="secondary" onClick={previousPage}>◁ Anterior</button><button className="primary" onClick={toggleReading}>{paused ? '▶ Retomar' : 'Ⅱ Pausar'}</button><button className="secondary" onClick={nextPage}>▷ Próxima</button></div><button className={`secondary ${operatorOverride ? 'manual-active' : ''}`} onClick={() => { takeManualControl(); setTab('Operação ao vivo') }}>Assumir controle manual</button><button className="secondary return" onClick={() => { chooseStory(0); sendCommand('resume'); setPaused(false) }}>↶ Retomar roteiro</button><details className="control-options"><summary>Ajustes de leitura · {speed.toFixed(1)}x · {fontSize} px</summary><div className="control-options-content"><div className="setting"><span>VELOCIDADE</span><button className="mini" onClick={() => setSpeed(Math.max(.5, +(speed - .1).toFixed(1)))}>−</button><strong>{speed.toFixed(1)}x</strong><button className="mini" onClick={() => setSpeed(Math.min(2, +(speed + .1).toFixed(1)))}>+</button><div className="range"><span style={{width:`${(speed-.5)/1.5*100}%`}}/></div></div><div className="setting"><span>FONTE</span><button className="mini" onClick={() => setFontSize(Math.max(24, fontSize - 2))}>A−</button><strong>{fontSize} px</strong><button className="mini" onClick={() => setFontSize(Math.min(60, fontSize + 2))}>A+</button></div></div></details></div>
      {paused && <div className="pause-banner">Leitura pausada. O operador mantém o controle da página atual.</div>}
    </main>}

    {tab === 'Improvisos' && <main className="page-wrap">
      <div className="page-title"><div><p className="eyebrow">REVISÃO EDITORIAL</p><h1>Registro de improvisos</h1><p>Revise as transcrições e mantenha as anotações vinculadas à matéria do espelho.</p></div><div className="edition"><strong>Jornal da Noite</strong><span>05 out. 2026 · Espelho v12</span></div></div>
      <div className="review-grid"><aside className="panel review-sidebar"><h3>Nesta edição</h3><label className="review-filter-label">Filtrar por matéria<select value={filter} onChange={e => setFilter(e.target.value)}><option>Todas as matérias</option>{editorialStories.map(s=><option key={s.id}>{s.headline}</option>)}</select></label>{hasReviewEvent && <div className="review-event"><div className="event-top"><strong>19:07:18</strong><span className="pill green">{reviewed ? 'Revisado' : 'Pendente'}</span></div><strong>Nova linha de ônibus</strong><p>A03 · Lucas Almeida · 8 segundos</p><small>Anotação do operador salva</small></div>}<details className="review-stats-details"><summary>Resumo da edição</summary><div className="review-stats"><span>RESUMO <b>{hasReviewEvent ? 1 : 0}</b></span><span>Revisados <b>{hasReviewEvent && reviewed ? 1 : 0}</b></span><span>Pendentes <b>{hasReviewEvent && !reviewed ? 1 : 0}</b></span><span>Tempo total fora do roteiro <b>{hasReviewEvent ? '00:08' : '00:00'}</b></span></div></details></aside>
        <section className="review-main">{hasReviewEvent ? <><article className="panel"><div className="review-title"><div><h2>A03 · Nova linha de ônibus</h2><p className="muted">Jornal da Noite · Bloco A · Roteiro v12</p></div><span className={`pill ${reviewed ? 'green' : 'yellow'}`}>● {reviewed ? 'Revisado' : '1 improviso'}</span></div><details className="event-details"><summary>Horário e apresentador</summary><div className="event-metadata"><span>INÍCIO<strong>19:07:18</strong></span><span>FINAL<strong>19:07:26</strong></span><span>DURAÇÃO<strong>8 segundos</strong></span><span>APRESENTADOR<strong>Lucas Almeida</strong></span></div></details><div className="transcript-box"><span>TRECHO TRANSCRITO · IMPROVISO</span><p>“É quem depende do transporte público sabe como essa espera faz diferença no dia a dia.”</p></div><p className="tiny muted">ROTEIRO RETOMADO · LINHA 19:07:27</p><p className="review-quote">O serviço começa na próxima segunda-feira, com viagens a cada quinze minutos nos horários de pico.</p></article>
          <article className="panel note-panel"><h3>Anotação do operador</h3><textarea value={operatorNote} onChange={e=>setOperatorNote(e.target.value)} /><div className="note-actions"><span className="success-text">● Anotação editável</span><div><button className="secondary" onClick={()=>alert('Exportação demonstrativa: conecte um backend para gerar o arquivo.')}>↓ Exportar registro</button><button className="primary" onClick={()=>setReviewed(true)}>✓ Salvar revisão</button></div></div></article></> : <div className="panel review-empty" role="status"><strong>Nenhum improviso para esta matéria</strong><p>Não há registros nesta prévia para “{filter}”. Selecione outra matéria ou escolha “Todas as matérias”.</p></div>}</section></div>
    </main>}

    {tab === 'Leitura ampliada' && <main className="page-wrap expanded-wrap">
      <div className="page-title"><div><p className="eyebrow">MODO DO APRESENTADOR</p><h1>Leitura ampliada</h1><p>Modo de manipulador · Controles essenciais sempre visíveis.</p></div><span className="pill green">● Demonstração</span></div>
      <div className="expanded-grid"><section className="panel expanded-script"><div className="prompter-head"><div><span className="pill green">● No ar · {story.code}</span><span className="pill editorial-category">{story.category} · Tom {story.tone}</span><strong>{story.headline}</strong></div><span className="page-count">Página {pageIndex + 1} de {story.pages.length}</span></div><div className="expanded-reading"><span className="script-label">PONTO DE LEITURA · FONTE {fontSize} PX</span>{story.alertLevel && story.alertLevel !== 'none' && <div className={`editorial-alert compact ${story.alertLevel}`}><strong>{story.alertLevel === 'critical' ? 'ALERTA EDITORIAL IMPORTANTE' : 'ATENÇÃO EDITORIAL'}</strong><p>{story.guidance}</p></div>}<div className="retranque" style={{fontSize:`${fontSize}px`}}>{page.title}</div><div style={{fontSize:`${fontSize}px`}}><ScriptText className="script-content" html={page.bodyHtml} text={page.text} /></div>{page.secondary && <div style={{fontSize:`${fontSize}px`}}><ScriptText className="script-content" html={page.secondaryHtml} text={page.secondary} /></div>}</div><div className="expanded-bottom"><span>À SEGUIR</span>{nextStory ? <><strong>{nextStory.headline}</strong><span>{nextStory.category} · {nextStory.tone}</span></> : <strong>Fim do espelho</strong>}<span>{globalPage}/{totalPages}</span></div></section><aside className="panel expanded-monitor"><div className="notice">Acompanhamento pela fala<p>Use o modo Teleprompter para acompanhar o ponto de leitura enquanto a fala coincide com o roteiro; não muda de página automaticamente.</p></div><button className="secondary full expanded-exit" onClick={() => setTab('Apresentador')}>Voltar à leitura</button></aside></div>
    </main>}

    {tab === 'Apresentador' && <main className="presenter-mode" style={{ backgroundColor: preferences.highContrast ? '#000000' : preferences.backgroundColor, color: preferences.highContrast ? '#ffffff' : preferences.textColor, fontFamily: preferences.fontFamily }}>
      <header className="presenter-header">
        <div className="brand"><div className="brand-mark">T</div><div><strong>Teleprompter</strong><span>Modo do apresentador</span></div></div>
        <div className="presenter-status"><span className="pill green">● {liveTranscribing ? 'Acompanhamento por voz' : operatorOverride ? 'Controle manual' : 'Leitura local'}</span><span>{story.code} · {story.headline}</span></div>
        <div className="presenter-header-actions"><label className="presenter-story-picker">Matéria<select aria-label="Selecionar matéria do roteiro" value={selectedStory} onChange={e => chooseStory(Number(e.target.value))}>{editorialStories.map((item, index) => <option key={item.id} value={index}>{item.code} · {item.headline}</option>)}</select></label><button className="secondary" onClick={() => setShowReadingSettings(value => !value)} aria-expanded={showReadingSettings} aria-controls="reading-settings">{showReadingSettings ? 'Fechar personalização' : 'Personalizar leitura'}</button><button className="secondary manual-control-button" onClick={takeManualControl}>Assumir controle</button><button className="secondary" onClick={() => setTab('Operação ao vivo')}>Voltar ao operador</button></div>
      </header>
      {showReadingSettings && <section className="reading-settings" id="reading-settings" aria-labelledby="reading-settings-title">
        <div className="reading-settings-heading"><div><h2 id="reading-settings-title">Personalização e acessibilidade</h2><p>As preferências são salvas neste navegador e aplicadas à leitura.</p></div><button className="secondary" onClick={restoreReadingDefaults}>Restaurar padrão</button></div>
        <div className="reading-settings-grid">
          <label>Família tipográfica<select value={preferences.fontFamily} onChange={e => setPreferences(value => ({ ...value, fontFamily: e.target.value }))}><option value="Arial, Helvetica, sans-serif">Arial</option><option value="Inter, system-ui, sans-serif">Inter</option><option value="Georgia, 'Times New Roman', serif">Georgia (serifada)</option><option value="'Trebuchet MS', Arial, sans-serif">Trebuchet MS</option><option value="Verdana, Geneva, sans-serif">Verdana</option><option value="system-ui, sans-serif">Fonte do sistema</option></select></label>
          <label>Tamanho do texto <span className="setting-value">{fontSize}px</span><input type="range" min="18" max="72" step="2" value={fontSize} onChange={e => setFontSize(Number(e.target.value))} aria-label="Tamanho do texto em pixels" /></label>
          <label>Cor de fundo<input type="color" value={preferences.backgroundColor} disabled={preferences.highContrast} onChange={e => setPreferences(value => ({ ...value, backgroundColor: e.target.value }))} /></label>
          <label>Cor do texto<input type="color" value={preferences.textColor} disabled={preferences.highContrast} onChange={e => setPreferences(value => ({ ...value, textColor: e.target.value }))} /></label>
          <label className="contrast-toggle"><input type="checkbox" checked={preferences.highContrast} onChange={e => setPreferences(value => ({ ...value, highContrast: e.target.checked }))} /> Alto contraste (fundo preto e texto branco)</label>
          <label>Velocidade de rolagem <span className="setting-value">{speed.toFixed(1)}x</span><input type="range" min="0.5" max="2" step="0.1" value={speed} onChange={e => setSpeed(Number(e.target.value))} aria-label="Velocidade de rolagem" /></label>
        </div>
        <p className={`contrast-feedback ${preferences.highContrast || contrastRatio(preferences.textColor, preferences.backgroundColor) >= 4.5 ? 'contrast-good' : 'contrast-warning'}`} role="status">{preferences.highContrast ? 'Alto contraste ativo.' : `Contraste entre texto e fundo: ${contrastRatio(preferences.textColor, preferences.backgroundColor).toFixed(2)}:1. ${contrastRatio(preferences.textColor, preferences.backgroundColor) >= 4.5 ? 'Adequado para texto normal.' : 'Considere escolher cores com razão mínima de 4,5:1.'}`}</p>
        <div className="theme-presets"><span>Temas rápidos</span><button className="secondary" onClick={() => setPreferences({ ...DEFAULT_PREFERENCES })}>Noturno</button><button className="secondary" onClick={() => setPreferences({ ...DEFAULT_PREFERENCES, backgroundColor: '#ffffff', textColor: '#172033' })}>Claro</button><button className="secondary" onClick={() => setPreferences({ ...DEFAULT_PREFERENCES, backgroundColor: '#000000', textColor: '#ffffff', highContrast: true })}>Alto contraste</button></div>
      </section>}
      <section className="presenter-stage">
        <div className="presenter-meta"><span>{story.category.toUpperCase()} · TOM: {story.tone.toUpperCase()} · {page.label}</span><span>Página {pageIndex + 1} de {story.pages.length}</span></div>
        {story.alertLevel && story.alertLevel !== 'none' && <div className={`presenter-editorial-alert ${story.alertLevel}`} role="status"><strong>{story.category}: {story.tone}</strong><span>{story.guidance}</span></div>}
        <section className={`presenter-speech-caption ${liveSpeechAssessment.kind}`} aria-label="Fala reconhecida ao vivo" aria-live="polite">
          <div className="presenter-speech-caption-heading"><strong>FALA RECONHECIDA</strong><span>{liveTranscribing ? 'MICROFONE ATIVO' : 'MICROFONE DESATIVADO'}</span></div>
          <p>{liveTranscript || 'O que você falar aparecerá aqui quando iniciar o microfone.'}</p>
          <small>{liveSpeechAssessment.message}</small>
          <div className="presenter-mic-meter" role="meter" aria-label="Nível de entrada do microfone" aria-valuemin={0} aria-valuemax={100} aria-valuenow={liveInputLevel}>
            <span><i style={{ width: `${liveInputLevel}%` }} /></span>
            <small>{liveTranscribing ? liveInputLevel >= 6 ? 'Som chegando pelo microfone' : 'Microfone ligado · fale para testar a entrada' : 'Entrada de áudio inativa'}</small>
          </div>
        </section>
        <div className={`presenter-reading ${preferences.highContrast ? 'high-contrast-reading' : ''}`} ref={presenterTextRef} onScroll={handlePresenterScroll} aria-label="Texto do teleprompter" tabIndex={0} style={{ backgroundColor: preferences.highContrast ? '#000000' : preferences.backgroundColor, color: preferences.highContrast ? '#ffffff' : preferences.textColor, fontFamily: preferences.fontFamily, borderColor: preferences.highContrast ? '#ffffff' : undefined }}>
          <div className="presenter-reading-inner">
            <div className="presenter-rundown-title" style={{ fontSize: `${fontSize}px` }}>{story.headline} · {page.title}</div>
            <div className="presenter-copy" style={{ fontSize: `${fontSize}px` }}><ScriptText className="script-content" html={page.bodyHtml} text={page.text} /></div>
            {page.secondary && <div className="presenter-copy" style={{ fontSize: `${fontSize}px` }}><ScriptText className="script-content" html={page.secondaryHtml} text={page.secondary} /></div>}
            {page.keywords.length > 0 && <p className="presenter-cue">Próximas referências: {page.keywords.join(' · ')}</p>}
          </div>
        </div>
        <div className="presenter-progress-label"><span>Progresso do roteiro</span><span>{globalPage} / {totalPages} páginas</span></div>
        <div className="presenter-progress"><span style={{width: `${progressPercent}%`}} /></div>
      </section>
      <section className="presenter-next-story" aria-label="Prévia da próxima matéria">
        <span className="tiny muted">A SEGUIR · PRÉVIA DA PRÓXIMA MATÉRIA</span>
        {nextStory ? <><strong>{nextStory.headline}</strong><span>{nextStory.category} · Tom {nextStory.tone}</span><p>{nextStory.pages[0]?.text}</p></> : <strong>Fim do espelho</strong>}
      </section>
      <section className="presenter-controls" aria-label="Controles do teleprompter">
        <div className="presenter-live-follow">
          <div><strong>Acompanhamento pela fala</strong><p className="tiny muted">A fala é comparada aos roteiros carregados; outro roteiro pode ser selecionado automaticamente quando identificado.</p></div>
          {liveTranscribing
            ? <button className="secondary" onClick={stopLiveTranscription}>Parar microfone</button>
            : <button className="secondary" disabled={liveFinalizing} onClick={() => void startLiveTranscription()}>{liveFinalizing ? 'Finalizando transcrição…' : 'Iniciar pelo microfone'}</button>}
          {liveTranscriptionStatus && <p className="transcription-status" role="status" aria-live="polite">{liveTranscriptionStatus}</p>}
        </div>
        <div className="presenter-transport">
          <button className="secondary" onClick={previousPage}>← Anterior</button>
          <div className="manual-scroll-controls"><button className="secondary" onClick={() => moveReadingPoint(-220)} aria-label="Rolar o texto para cima">↑ Texto</button><button className="secondary" onClick={() => moveReadingPoint(220)} aria-label="Rolar o texto para baixo">↓ Texto</button></div>
          <button className="primary presenter-pause" onClick={toggleReading}>{paused ? '▶ Retomar leitura' : 'Ⅱ Pausar leitura'}</button>
          <button className="secondary" onClick={nextPage}>Próxima →</button>
        </div>
        <div className="presenter-adjustment"><label htmlFor="presenter-speed">Velocidade <strong>{speed.toFixed(1)}x</strong></label><input id="presenter-speed" type="range" min="0.5" max="2" step="0.1" value={speed} onChange={e => setSpeed(Number(e.target.value))} /><div className="adjustment-ends"><span>Lenta</span><span>Rápida</span></div></div>
        <div className="presenter-adjustment font-adjustment"><label>Tamanho do texto <strong>{fontSize}px</strong></label><div className="font-buttons"><button className="secondary" onClick={() => setFontSize(Math.max(24, fontSize - 2))} aria-label="Diminuir tamanho do texto">A−</button><button className="secondary" onClick={() => setFontSize(Math.min(60, fontSize + 2))} aria-label="Aumentar tamanho do texto">A+</button></div></div>
      </section>
      {paused && <div className="presenter-paused" role="status">Leitura pausada. O texto permanece nesta página até a retomada.</div>}
      <p className="presenter-hint">A posição pode acompanhar a fala pelo microfone ou ser controlada manualmente. Atalhos: Espaço pausa/retoma · ← página anterior · → próxima página · +/− tamanho do texto · Esc fecha a personalização.</p>
    </main>}

    {tab !== 'Apresentador' && <footer className="app-footer"><span>Controles manuais disponíveis · sincronização da sessão em tempo real</span><span>Operador: Mariana Costa · Estação OP-02</span></footer>}
    {showExpanded && <div className="modal-backdrop" role="presentation" onClick={()=>setShowExpanded(false)}><section className="modal panel" role="dialog" aria-modal="true" aria-label="Prévia de leitura ampliada" onClick={e=>e.stopPropagation()}><div className="panel-heading"><h2>Prévia da leitura ampliada</h2><button className="secondary" onClick={()=>setShowExpanded(false)}>Fechar ×</button></div><h3>{story.headline}</h3><p style={{fontSize:`${fontSize}px`,lineHeight:1.35}}>{page.text}</p><button className="primary" onClick={()=>{setTab('Leitura ampliada');setShowExpanded(false)}}>Abrir modo ampliado</button></section></div>}
  </div>
}
export default App
