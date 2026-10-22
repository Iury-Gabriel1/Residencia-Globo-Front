import { useEffect, useMemo, useRef, useState } from 'react'
import storyData from './data/stories.json'
import type { Story } from './types/script'

const initialStories = storyData as Story[]
type Tab = 'Conexão iNEWS' | 'Operação ao vivo' | 'Improvisos' | 'Leitura ampliada' | 'Apresentador'
type ReadingPreferences = { fontFamily: string; backgroundColor: string; textColor: string; highContrast: boolean }
const DEFAULT_PREFERENCES: ReadingPreferences = { fontFamily: 'Arial, Helvetica, sans-serif', backgroundColor: '#0d1322', textColor: '#f4f6fd', highContrast: false }
const PREFERENCES_KEY = 'teleprompter-reading-preferences-v1'
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
  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(() => { try { const saved = localStorage.getItem(PREFERENCES_KEY); return saved ? Number(JSON.parse(saved).speed) || 1 : 1 } catch { return 1 } })
  const [fontSize, setFontSize] = useState(() => { try { const saved = localStorage.getItem(PREFERENCES_KEY); return saved ? Number(JSON.parse(saved).fontSize) || 36 : 36 } catch { return 36 } })
  const [preferences, setPreferences] = useState<ReadingPreferences>(() => { try { const saved = localStorage.getItem(PREFERENCES_KEY); if (saved) { const parsed = JSON.parse(saved); return { ...DEFAULT_PREFERENCES, ...parsed.preferences } } } catch { /* usa os padrões */ } return DEFAULT_PREFERENCES })
  const [showReadingSettings, setShowReadingSettings] = useState(false)
  const [connected, setConnected] = useState(false)
  const [reviewed, setReviewed] = useState(false)
  const [operatorNote, setOperatorNote] = useState('Comentário espontâneo sobre a espera dos passageiros. Mantive o ponto de leitura e retomei na linha 05 após o fim da fala. Sem alteração do roteiro original.')
  const [showExpanded, setShowExpanded] = useState(false)
  const [filter, setFilter] = useState('Todas as matérias')
  const [classificationSaved, setClassificationSaved] = useState(true)
  const [operatorOverride, setOperatorOverride] = useState(false)
  const presenterTextRef = useRef<HTMLDivElement>(null)

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
      else if (event.key === '+' || event.key === '=') { event.preventDefault(); setFontSize(value => Math.min(72, value + 2)) }
      else if (event.key === '-') { event.preventDefault(); setFontSize(value => Math.max(18, value - 2)) }
      else if (event.key === 'Escape') setShowReadingSettings(false)
    }
    window.addEventListener('keydown', handlePresenterKeys)
    return () => window.removeEventListener('keydown', handlePresenterKeys)
  }, [tab, selectedStory, pageIndex])

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
    if (tab === 'Apresentador' && presenterTextRef.current) presenterTextRef.current.scrollTop = 0
  }, [tab, selectedStory, pageIndex])

  const story = editorialStories[selectedStory]
  const nextStory = editorialStories[selectedStory + 1]
  const page = story.pages[Math.min(pageIndex, story.pages.length - 1)]
  const totalPages = useMemo(() => editorialStories.reduce((sum, item) => sum + item.pages.length, 0), [])
  const globalPage = editorialStories.slice(0, selectedStory).reduce((sum, item) => sum + item.pages.length, 0) + pageIndex + 1

  function takeManualControl() {
    setOperatorOverride(true)
    setPaused(true)
  }
  function toggleReading() {
    setOperatorOverride(true)
    setPaused(value => !value)
  }
  function chooseStory(index: number) {
    if (!editorialStories[index]) return
    setSelectedStory(index)
    setPageIndex(0)
    takeManualControl()
  }
  function choosePage(index: number) {
    if (!story.pages[index]) return
    setPageIndex(index)
    takeManualControl()
  }
  function updateCurrentStory(patch: Partial<Story>) {
    setEditorialStories(current => current.map((item, index) => index === selectedStory ? { ...item, ...patch } : item))
    setClassificationSaved(false)
  }
  function saveClassification() {
    try { localStorage.setItem('teleprompter-editorial-stories-v1', JSON.stringify(editorialStories)) } catch { /* classificação permanece nesta sessão */ }
    setClassificationSaved(true)
  }
  function previousPage() {
    takeManualControl()
    if (pageIndex > 0) setPageIndex(pageIndex - 1)
    else if (selectedStory > 0) {
      const previousStory = editorialStories[selectedStory - 1]
      if (previousStory.pages.length > 0) {
        setSelectedStory(selectedStory - 1)
        setPageIndex(previousStory.pages.length - 1)
      }
    }
  }
  function nextPage() {
    takeManualControl()
    if (pageIndex < story.pages.length - 1) setPageIndex(pageIndex + 1)
    else if (selectedStory < editorialStories.length - 1) {
      const followingStory = editorialStories[selectedStory + 1]
      if (followingStory.pages.length > 0) {
        setSelectedStory(selectedStory + 1)
        setPageIndex(0)
      }
    }
  }

  return <div className="app">
    <header className="topbar">
      <div className="brand"><div className="brand-mark">T</div><div><strong>Teleprompter</strong><span>Console do operador</span></div></div>
      <div className="top-meta"><span className="environment">AMBIENTE DE DEMONSTRAÇÃO</span><span className={`connection ${connected ? 'online' : ''}`}>● {connected ? 'iNEWS · conectado' : 'iNEWS · configuração'}</span><strong>19:07:12</strong><span className="avatar">MC</span></div>
    </header>

    <nav className="tabs" aria-label="Navegação principal">
      {(['Conexão iNEWS', 'Operação ao vivo', 'Improvisos', 'Leitura ampliada', 'Apresentador'] as Tab[]).map((item, index) =>
        <button key={item} className={`tab ${tab === item ? 'active' : ''}`} onClick={() => setTab(item)}>
          {['↔','◉','≋','▣','▶'][index]} {item === 'Apresentador' ? 'Teleprompter' : item}{item === 'Improvisos' && <span className="tab-count">1</span>}
        </button>)}
      <div className="station">Estúdio A / Mariana Costa</div>
    </nav>

    {tab === 'Conexão iNEWS' && <main className="page-wrap">
      <div className="page-title"><div><p className="eyebrow">CONFIGURAÇÃO E IMPORTAÇÃO</p><h1>Preparar a operação</h1><p>Configure a integração e escolha o espelho que será acompanhado no teleprompter.</p></div><span className="date-label">05 out. 2026 · 19:00–19:30 · Espelho v12</span></div>
      <div className="setup-grid">
        <section className="panel connection-panel"><h3>♧　Conexão ao iNEWS</h3><p className="muted">Perfil de exemplo para a redação. Nenhuma conexão real será estabelecida.</p>
          <label>Servidor iNEWS<input defaultValue="inews.redacao.exemplo" /></label><div className="input-row"><label>Usuário<input defaultValue="operador.estudio.a" /></label><label>Porta<input defaultValue="443" /></label></div><label>Senha<input type="password" defaultValue="demonstracao" /></label>
          <div className="secure">✓ Conexão segura · TLS</div><button className="primary full" onClick={() => setConnected(!connected)}>{connected ? 'Desconectar' : 'Testar conexão'}</button>
          <div className={`notice ${connected ? 'success' : ''}`}>● {connected ? 'Teste concluído' : 'Teste de conexão · exemplo'}<p>{connected ? 'Estado simulado como conectado. Nenhuma chamada externa foi realizada.' : 'Servidor validado no ambiente ilustrativo. Espelhos disponíveis para seleção.'}</p></div>
          <p className="tiny muted">A importação preserva a ordem das matérias e a divisão do texto em páginas.</p>
        </section>
        <section className="panel import-panel"><div className="panel-heading"><h3>Selecionar espelho</h3><button className="secondary" onClick={() => setConnected(false)}>↻ Atualizar lista</button></div><select className="mirror-select" defaultValue="jornal"><option value="jornal">Jornal da Noite — 05/10/2026</option><option value="manha">Jornal da Manhã — demonstração</option></select>
          <div className="table-heading"><div><h3>Prévia da importação</h3><p className="muted">Bloco A · {editorialStories.length} matérias · {totalPages} páginas</p></div><span className="tiny muted">PRÉVIA</span></div>
          <div className="data-table"><div className="table-row table-head"><span>ID</span><span>MATÉRIA</span><span>FORMATO</span><span>DURAÇÃO</span></div>{editorialStories.map((s, i) => <div className="table-row" key={s.id}><span>{s.code}</span><span>{s.headline}</span><span>{i === 0 ? 'CABEÇA + VT' : 'NOTA'}</span><span>00:{String(45 + i * 15).padStart(2, '0')}</span></div>)}</div>
          <div className="import-bottom"><span className="success-text">✓ {totalPages} textos prontos</span><button className="primary" onClick={() => { setConnected(true); setTab('Operação ao vivo') }}>↓ Importar espelho e abrir operação</button></div>
        </section>
      </div>
    </main>}

    {tab === 'Operação ao vivo' && <main className="page-wrap">
      <div className="page-title"><div><p className="eyebrow">ACOMPANHAMENTO DA LEITURA</p><h1>Operação ao vivo</h1><p>Espelho importado · Acompanhamento da leitura e da voz do apresentador.</p></div><div className="edition"><strong>Jornal da Noite</strong><span>05 out. 2026 · 19:00–19:30 · Espelho v12</span></div></div>
      <div className="live-grid">
        <aside className="panel rundown"><div className="panel-heading"><h3>Espelho do jornal</h3><span className="pill green">● Sincronizado · v12</span></div><p className="tiny muted">Bloco A · {editorialStories.length} matérias · {totalPages} páginas</p>
          <div className="rundown-list">{editorialStories.map((s, i) => <button key={s.id} className={`rundown-item ${selectedStory === i ? 'selected' : ''}`} onClick={() => chooseStory(i)}><span className="rundown-code">{s.code}</span><span className="rundown-copy"><strong>{s.headline}</strong><small>{s.category} · {s.pages.length} pág.</small>{(s.alertLevel === 'critical' || s.alertLevel === 'attention') && <em className={`rundown-alert ${s.alertLevel}`}>{s.alertLevel === 'critical' ? 'Alerta importante' : 'Atenção editorial'}</em>}</span>{selectedStory === i && <span className="now">No ar</span>}</button>)}</div>
        </aside>
        <section className="panel prompter-panel">
          <div className="prompter-head"><div><span className="pill green">● No ar · {story.code}</span><span className="pill editorial-category">{story.category} · Tom {story.tone}</span><strong>{story.headline}</strong><small>{story.pages.length} página(s) · Texto iNEWS v12</small></div><div className="operator-page-picker"><label>Página atual<select aria-label="Selecionar página da matéria" value={pageIndex} onChange={e => choosePage(Number(e.target.value))}>{story.pages.map((item, index) => <option key={item.id} value={index}>{index + 1}. {item.title}</option>)}</select></label><div className="page-count">Página {pageIndex + 1} de {story.pages.length}<br/><span>Página geral {globalPage}/{totalPages}</span></div></div></div>
          <div className="script-area">
            <div className="script-label">{page.label} <span>· {story.category.toUpperCase()} · TOM {story.tone.toUpperCase()}</span></div>
            {(story.alertLevel === 'critical' || story.alertLevel === 'attention') && <div className={`editorial-alert compact ${story.alertLevel}`}><strong>{story.category} · {story.tone}</strong><p>{story.guidance}</p></div>}
            <h2>{page.text}</h2>
            {page.secondary && <p>{page.secondary}</p>}
            <span className="script-keywords">Palavras-chave: {page.keywords.join(' · ')}</span>
          </div>
          <div className="prompter-footer"><span>Linha {String(pageIndex + 4).padStart(2, '0')} de {String(totalPages * 3).padStart(2, '0')}</span><div className="progress"><span style={{width: `${globalPage / totalPages * 100}%`}} /></div><span>00:24 / 02:30</span><button className="secondary small" onClick={() => setShowExpanded(true)}>↗ Ampliar</button></div>
        </section>
        <aside className="panel voice-panel"><h3>Voz do apresentador</h3><span className="pill green">● Escuta ativa · exemplo</span><p className="muted">Lucas Almeida · Microfone 01</p><div className="waveform" aria-label="Representação ilustrativa de atividade de áudio">{Array.from({length:34}, (_,i)=><i key={i} style={{height: `${8 + Math.abs(Math.sin(i * 1.7)) * (i % 5 === 0 ? 25 : 16)}px`}} />)}</div><div className="voice-stats"><span>Nível -16 dB</span><span className="green-text">Sinal estável</span></div><div className="voice-transcript"><span className="tiny muted">FALA RECONHECIDA · EXEMPLO</span><p>“A expectativa é atender oito mil passageiros por dia...”</p><span className="tiny muted">Confiança da transcrição: 96%</span></div><div className="notice success">Acompanhando o roteiro<p>Linha 04 de 18 · Ritmo estimado: 142 palavras/min.</p></div><p className="tiny muted">A captura e a transcrição de áudio ainda não estão conectadas.</p></aside>
      </div>
      <section className="panel editorial-panel">
        <div className="panel-heading"><div><p className="eyebrow">IDENTIFICAÇÃO EDITORIAL</p><h3>Classificação da matéria selecionada</h3></div><span className={`pill ${classificationSaved ? 'green' : 'yellow'}`}>{classificationSaved ? 'Salvo neste navegador' : 'Alterações não salvas'}</span></div>
        <div className="editorial-current"><div className={`editorial-alert ${story.alertLevel || 'none'}`}><strong>{story.alertLevel === 'critical' ? 'ALERTA EDITORIAL IMPORTANTE' : story.alertLevel === 'attention' ? 'ATENÇÃO EDITORIAL' : 'ORIENTAÇÃO EDITORIAL'}</strong><p>{story.guidance || 'Revise a chamada e o tom antes de iniciar a leitura.'}</p></div><div className="next-story-preview"><span className="tiny muted">PRÓXIMA MATÉRIA · PRÉVIA</span>{nextStory ? <><strong>{nextStory.headline}</strong><span>{nextStory.category} · Tom: {nextStory.tone}</span><p>{nextStory.pages[0]?.text}</p></> : <strong className="next-story-empty">Fim do espelho</strong>}</div></div>
        <div className="editorial-form">
          <label>Chamada / título descritivo<input value={story.headline} onChange={e => updateCurrentStory({ headline: e.target.value })} /></label>
          <label>Categoria editorial<select value={story.category} onChange={e => { const category = e.target.value as Story['category']; const defaults: Record<string, {tone:string; guidance:string; alertLevel:'none'|'attention'|'critical'}> = { 'Notícia séria': {tone:'Sóbrio',guidance:'Manter expressão séria, ritmo estável e linguagem respeitosa.',alertLevel:'attention'}, 'Falecimento': {tone:'Sóbrio e respeitoso',guidance:'Notícia de falecimento: evitar sorriso e tom celebratório. Manter postura respeitosa.',alertLevel:'critical'}, 'Política': {tone:'Informativo e neutro',guidance:'Manter neutralidade e separar fatos de opiniões.',alertLevel:'attention'}, 'Previsão do tempo': {tone:'Natural e informativo',guidance:'Tom acessível, sem exagerar a expressividade.',alertLevel:'none'}, 'Conteúdo leve': {tone:'Leve',guidance:'Tom natural e acolhedor, adequado ao conteúdo.',alertLevel:'none'}, 'Cidade': {tone:'Informativo',guidance:'Destacar o impacto do assunto para a população.',alertLevel:'none'}, 'Economia': {tone:'Objetivo',guidance:'Dar atenção aos números e aos seus impactos.',alertLevel:'none'}, 'Cultura': {tone:'Informativo',guidance:'Apresentar contexto e relevância cultural.',alertLevel:'none'} }; updateCurrentStory({ category, ...(defaults[category] || {}) }) }}><option>Notícia séria</option><option>Falecimento</option><option>Política</option><option>Previsão do tempo</option><option>Conteúdo leve</option><option>Cidade</option><option>Economia</option><option>Cultura</option></select></label>
          <label>Tom editorial definido pelo operador<input value={story.tone} onChange={e => updateCurrentStory({ tone: e.target.value })} placeholder="Ex.: sóbrio, neutro, acolhedor" /></label>
          <label>Nível de alerta<select value={story.alertLevel || 'none'} onChange={e => updateCurrentStory({ alertLevel: e.target.value as Story['alertLevel'] })}><option value="none">Sem alerta</option><option value="attention">Atenção editorial</option><option value="critical">Alerta importante</option></select></label>
          <label className="editorial-guidance">Orientação para o apresentador<textarea value={story.guidance} onChange={e => updateCurrentStory({ guidance: e.target.value })} rows={2} /></label>
        </div>
        <div className="editorial-actions"><span className="tiny muted">A classificação é manual e fica salva neste navegador.</span><button className="primary" onClick={saveClassification}>Salvar classificação</button></div>
      </section>
      <div className="control-bar"><div className="transport"><button className="secondary" onClick={previousPage}>◁ Anterior</button><button className="primary" onClick={toggleReading}>{paused ? '▶ Retomar' : 'Ⅱ Pausar'}</button><button className="secondary" onClick={nextPage}>▷ Próxima</button></div><div className="setting"><span>VELOCIDADE</span><button className="mini" onClick={() => setSpeed(Math.max(.5, +(speed - .1).toFixed(1)))}>−</button><strong>{speed.toFixed(1)}x</strong><button className="mini" onClick={() => setSpeed(Math.min(2, +(speed + .1).toFixed(1)))}>+</button><div className="range"><span style={{width:`${(speed-.5)/1.5*100}%`}}/></div></div><div className="setting"><span>FONTE</span><button className="mini" onClick={() => setFontSize(Math.max(24, fontSize - 2))}>A−</button><strong>{fontSize} px</strong><button className="mini" onClick={() => setFontSize(Math.min(60, fontSize + 2))}>A+</button></div><button className={`secondary ${operatorOverride ? 'manual-active' : ''}`} onClick={() => { takeManualControl(); setTab('Operação ao vivo') }}>Assumir controle manual</button><button className="secondary return" onClick={() => { chooseStory(0); setPaused(false) }}>↶ Retomar roteiro</button></div>
      {paused && <div className="pause-banner">Leitura pausada. O operador mantém o controle da página atual.</div>}
    </main>}

    {tab === 'Improvisos' && <main className="page-wrap">
      <div className="page-title"><div><p className="eyebrow">REVISÃO EDITORIAL</p><h1>Registro de improvisos</h1><p>Revise as transcrições e mantenha as anotações vinculadas à matéria do espelho.</p></div><div className="edition"><strong>Jornal da Noite</strong><span>05 out. 2026 · Espelho v12</span></div></div>
      <div className="review-grid"><aside className="panel review-sidebar"><h3>Nesta edição</h3><select value={filter} onChange={e => setFilter(e.target.value)}><option>Todas as matérias</option>{editorialStories.map(s=><option key={s.id}>{s.headline}</option>)}</select><div className="review-event"><div className="event-top"><strong>19:07:18</strong><span className="pill green">{reviewed ? 'Revisado' : 'Pendente'}</span></div><strong>Nova linha de ônibus</strong><p>A03 · Lucas Almeida · 8 segundos</p><small>Anotação do operador salva</small></div><div className="review-stats"><span>RESUMO <b>1</b></span><span>Revisados <b>{reviewed ? 1 : 0}</b></span><span>Pendentes <b>{reviewed ? 0 : 1}</b></span><span>Tempo total fora do roteiro <b>00:08</b></span></div></aside>
        <section className="review-main"><article className="panel"><div className="review-title"><div><h2>A03 · Nova linha de ônibus</h2><p className="muted">Jornal da Noite · Bloco A · Texto iNEWS v12</p></div><span className={`pill ${reviewed ? 'green' : 'yellow'}`}>● {reviewed ? 'Revisado' : '1 improviso'}</span></div><div className="event-metadata"><span>INÍCIO<strong>19:07:18</strong></span><span>FINAL<strong>19:07:26</strong></span><span>DURAÇÃO<strong>8 segundos</strong></span><span>APRESENTADOR<strong>Lucas Almeida</strong></span></div><div className="transcript-box"><span>TRECHO TRANSCRITO · IMPROVISO</span><p>“É quem depende do transporte público sabe como essa espera faz diferença no dia a dia.”</p></div><p className="tiny muted">ROTEIRO RETOMADO · LINHA 19:07:27</p><p className="review-quote">O serviço começa na próxima segunda-feira, com viagens a cada quinze minutos nos horários de pico.</p></article>
          <article className="panel note-panel"><h3>Anotação do operador</h3><textarea value={operatorNote} onChange={e=>setOperatorNote(e.target.value)} /><div className="note-actions"><span className="success-text">● Anotação editável</span><div><button className="secondary" onClick={()=>alert('Exportação demonstrativa: conecte um backend para gerar o arquivo.')}>↓ Exportar registro</button><button className="primary" onClick={()=>setReviewed(true)}>✓ Salvar revisão</button></div></div></article></section></div>
    </main>}

    {tab === 'Leitura ampliada' && <main className="page-wrap expanded-wrap">
      <div className="page-title"><div><p className="eyebrow">MODO DO APRESENTADOR</p><h1>Leitura ampliada</h1><p>Modo de manipulador · Controles essenciais sempre visíveis.</p></div><span className="pill green">● Demonstração</span></div>
      <div className="expanded-grid"><section className="panel expanded-script"><div className="prompter-head"><div><span className="pill green">● No ar · {story.code}</span><span className="pill editorial-category">{story.category} · Tom {story.tone}</span><strong>{story.headline}</strong></div><span className="page-count">Página {pageIndex + 1} de {story.pages.length}</span></div><div className="expanded-reading"><span className="script-label">PONTO DE LEITURA · FONTE {fontSize} PX</span>{story.alertLevel && story.alertLevel !== 'none' && <div className={`editorial-alert compact ${story.alertLevel}`}><strong>{story.alertLevel === 'critical' ? 'ALERTA EDITORIAL IMPORTANTE' : 'ATENÇÃO EDITORIAL'}</strong><p>{story.guidance}</p></div>}<h2 style={{fontSize: `${fontSize}px`}}>{page.text}</h2>{page.secondary && <p>{page.secondary}</p>}</div><div className="expanded-bottom"><span>À SEGUIR</span>{nextStory ? <><strong>{nextStory.headline}</strong><span>{nextStory.category} · {nextStory.tone}</span></> : <strong>Fim do espelho</strong>}<span>{globalPage}/{totalPages}</span></div></section><aside className="panel expanded-monitor"><h3>Monitor de operação</h3><span className="pill green">● Escuta ativa · exemplo</span><p className="muted">Lucas Almeida · Microfone 01</p><div className="waveform">{Array.from({length:24},(_,i)=><i key={i} style={{height:`${8+Math.abs(Math.sin(i*1.4))*22}px`}} />)}</div><hr/><h3>iNEWS</h3><span className="pill green">● Sincronizado · v12</span><p className="tiny muted">Jornal da Noite · Bloco A</p><div className="notice warning">1 improviso registrado<p>19:07:18–19:07:26 · A03</p><button className="secondary small" onClick={()=>setTab('Improvisos')}>Ver registro</button></div><button className="secondary full" onClick={()=>setTab('Operação ao vivo')}>Sair da leitura ampliada</button></aside></div>
    </main>}

    {tab === 'Apresentador' && <main className="presenter-mode" style={{ backgroundColor: preferences.highContrast ? '#000000' : preferences.backgroundColor, color: preferences.highContrast ? '#ffffff' : preferences.textColor, fontFamily: preferences.fontFamily }}>
      <header className="presenter-header">
        <div className="brand"><div className="brand-mark">T</div><div><strong>Teleprompter</strong><span>Modo do apresentador</span></div></div>
        <div className="presenter-status"><span className="pill green">● {operatorOverride ? 'Controle manual' : 'Leitura local · sem IA'}</span><span>{story.code} · {story.headline}</span></div>
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
        <div className={`presenter-reading ${preferences.highContrast ? 'high-contrast-reading' : ''}`} ref={presenterTextRef} aria-label="Texto do teleprompter" tabIndex={0} style={{ backgroundColor: preferences.highContrast ? '#000000' : preferences.backgroundColor, color: preferences.highContrast ? '#ffffff' : preferences.textColor, fontFamily: preferences.fontFamily, borderColor: preferences.highContrast ? '#ffffff' : undefined }}>
          <div className="presenter-reading-inner">
            <h1 style={{ color: preferences.highContrast ? '#ffffff' : preferences.textColor }}>{story.headline}</h1>
            <h2 style={{fontSize: `${fontSize}px`, color: preferences.highContrast ? '#ffffff' : preferences.textColor, borderLeftColor: preferences.highContrast ? '#ffff00' : '#655cf6'}}>{page.text}</h2>
            {page.secondary && <p style={{fontSize: `${Math.max(18, fontSize * 0.62)}px`, color: preferences.highContrast ? '#ffffff' : preferences.textColor}}>{page.secondary}</p>}
            {page.keywords.length > 0 && <p className="presenter-cue">Próximas referências: {page.keywords.join(' · ')}</p>}
          </div>
        </div>
        <div className="presenter-progress-label"><span>Progresso do roteiro</span><span>{globalPage} / {totalPages} páginas</span></div>
        <div className="presenter-progress"><span style={{width: `${globalPage / totalPages * 100}%`}} /></div>
      </section>
      <section className="presenter-next-story" aria-label="Prévia da próxima matéria">
        <span className="tiny muted">A SEGUIR · PRÉVIA DA PRÓXIMA MATÉRIA</span>
        {nextStory ? <><strong>{nextStory.headline}</strong><span>{nextStory.category} · Tom {nextStory.tone}</span><p>{nextStory.pages[0]?.text}</p></> : <strong>Fim do espelho</strong>}
      </section>
      <section className="presenter-controls" aria-label="Controles do teleprompter">
        <div className="presenter-transport">
          <button className="secondary" onClick={previousPage}>← Anterior</button>
          <button className="primary presenter-pause" onClick={toggleReading}>{paused ? '▶ Retomar leitura' : 'Ⅱ Pausar leitura'}</button>
          <button className="secondary" onClick={nextPage}>Próxima →</button>
        </div>
        <div className="presenter-adjustment"><label htmlFor="presenter-speed">Velocidade <strong>{speed.toFixed(1)}x</strong></label><input id="presenter-speed" type="range" min="0.5" max="2" step="0.1" value={speed} onChange={e => setSpeed(Number(e.target.value))} /><div className="adjustment-ends"><span>Lenta</span><span>Rápida</span></div></div>
        <div className="presenter-adjustment font-adjustment"><label>Tamanho do texto <strong>{fontSize}px</strong></label><div className="font-buttons"><button className="secondary" onClick={() => setFontSize(Math.max(24, fontSize - 2))} aria-label="Diminuir tamanho do texto">A−</button><button className="secondary" onClick={() => setFontSize(Math.min(60, fontSize + 2))} aria-label="Aumentar tamanho do texto">A+</button></div></div>
      </section>
      {paused && <div className="presenter-paused" role="status">Leitura pausada. O texto permanece nesta página até a retomada.</div>}
      <p className="presenter-hint">Leitura e navegação funcionam localmente, sem IA ou conexão externa. Atalhos: Espaço pausa/retoma · ← página anterior · → próxima página · +/− tamanho do texto · Esc fecha a personalização.</p>
    </main>}

    {tab !== 'Apresentador' && <footer className="app-footer"><span>Protótipo estático · Estados de iNEWS e áudio são simulados</span><span>Operador: Mariana Costa · Estação OP-02</span></footer>}
    {showExpanded && <div className="modal-backdrop" role="presentation" onClick={()=>setShowExpanded(false)}><section className="modal panel" role="dialog" aria-modal="true" aria-label="Prévia de leitura ampliada" onClick={e=>e.stopPropagation()}><div className="panel-heading"><h2>Prévia da leitura ampliada</h2><button className="secondary" onClick={()=>setShowExpanded(false)}>Fechar ×</button></div><h3>{story.headline}</h3><p style={{fontSize:`${fontSize}px`,lineHeight:1.35}}>{page.text}</p><button className="primary" onClick={()=>{setTab('Leitura ampliada');setShowExpanded(false)}}>Abrir modo ampliado</button></section></div>}
  </div>
}
export default App
