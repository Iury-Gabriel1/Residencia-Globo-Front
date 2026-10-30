import { useLayoutEffect, useRef } from 'react'

type Format = 'highlight' | 'covered'
type ScriptTextProps = { html?: string; text: string; className?: string }
type ScriptEditorProps = {
  label: string
  html?: string
  text: string
  onChange: (html: string, text: string) => void
}

const allowedTags = new Set(['BR', 'DIV', 'EM', 'I', 'MARK', 'P', 'STRONG', 'U', 'B'])

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]!)
}

export function sanitizeScriptHtml(value: string) {
  const parsed = new DOMParser().parseFromString(value, 'text/html')

  function serialize(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return escapeHtml(node.textContent ?? '')
    if (!(node instanceof Element)) return ''
    const children = Array.from(node.childNodes, serialize).join('')
    if (!allowedTags.has(node.tagName)) return children
    if (node.tagName === 'BR') return '<br>'
    if (node.tagName === 'U' && node.getAttribute('data-kind') === 'covered') {
      return `<u data-kind="covered">${children}</u>`
    }
    return `<${node.tagName.toLowerCase()}>${children}</${node.tagName.toLowerCase()}>`
  }

  return Array.from(parsed.body.childNodes, serialize).join('')
}

export function scriptTextFromHtml(value: string) {
  const parsed = new DOMParser().parseFromString(value, 'text/html')
  const blockTags = new Set(['DIV', 'P'])

  function text(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof Element)) return ''
    if (node.tagName === 'BR') return '\n'
    const contents = Array.from(node.childNodes, text).join('')
    return blockTags.has(node.tagName) ? `${contents}\n` : contents
  }

  return Array.from(parsed.body.childNodes, text).join('').replace(/\n+$/, '')
}

export function ScriptText({ html, text, className }: ScriptTextProps) {
  const safeHtml = sanitizeScriptHtml(html ?? escapeHtml(text).replace(/\n/g, '<br>'))
  return <div className={className} dangerouslySetInnerHTML={{ __html: safeHtml }} />
}

export function ScriptEditor({ label, html, text, onChange }: ScriptEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null)
  const safeHtml = sanitizeScriptHtml(html ?? escapeHtml(text).replace(/\n/g, '<br>'))

  useLayoutEffect(() => {
    const editor = editorRef.current
    if (editor && document.activeElement !== editor && editor.innerHTML !== safeHtml) {
      editor.innerHTML = safeHtml
    }
  }, [safeHtml])

  function publishChange() {
    const editor = editorRef.current
    if (!editor) return
    const sanitized = sanitizeScriptHtml(editor.innerHTML)
    if (editor.innerHTML !== sanitized) editor.innerHTML = sanitized
    onChange(sanitized, scriptTextFromHtml(sanitized))
  }

  function applyFormat(format: Format) {
    const editor = editorRef.current
    const selection = window.getSelection()
    if (!editor || !selection?.rangeCount || selection.isCollapsed) return
    const range = selection.getRangeAt(0)
    if (!editor.contains(range.commonAncestorContainer)) return

    const wrapper = document.createElement(format === 'highlight' ? 'mark' : 'u')
    if (format === 'covered') wrapper.dataset.kind = 'covered'
    wrapper.append(range.extractContents())
    range.insertNode(wrapper)
    selection.removeAllRanges()
    const selected = document.createRange()
    selected.selectNodeContents(wrapper)
    selection.addRange(selected)
    publishChange()
  }

  return <section className="script-editor-field">
    <label>{label}</label>
    <div className="format-toolbar" role="toolbar" aria-label={`Formatação de ${label}`}>
      <button type="button" className="secondary small" onMouseDown={event => event.preventDefault()} onClick={() => applyFormat('highlight')}>Marca-texto</button>
      <button type="button" className="secondary small" onMouseDown={event => event.preventDefault()} onClick={() => applyFormat('covered')}>Sublinhar nota coberta</button>
    </div>
    <div
      ref={editorRef}
      className="script-editor"
      contentEditable
      suppressContentEditableWarning
      role="textbox"
      aria-multiline="true"
      aria-label={label}
      onInput={publishChange}
      onBlur={() => {
        const editor = editorRef.current
        if (editor && editor.innerHTML !== safeHtml) editor.innerHTML = safeHtml
      }}
    />
  </section>
}
