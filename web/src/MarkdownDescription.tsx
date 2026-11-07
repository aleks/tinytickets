import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import DOMPurify from 'dompurify'

// Rerender diagrams when either browser appearance preference changes.
function useAppearance() {
  const key = () => `${document.documentElement.dataset.theme}:${document.documentElement.dataset.accent}`
  const [appearance, setAppearance] = useState(key)
  useEffect(() => {
    const observer = new MutationObserver(() => setAppearance(key()))
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent'] })
    return () => observer.disconnect()
  }, [])
  return appearance
}

let diagramID = 0
function MermaidDiagram({ source, appearance }: { source: string; appearance: string }) {
  const container = useRef<HTMLDivElement>(null)
  const [error, setError] = useState(false)
  useEffect(() => {
    let cancelled = false
    setError(false)
    if (container.current) container.current.replaceChildren()
    async function render() {
      try {
        if (source.length > 20000) throw new Error('Diagram is too large')
        // Keep Mermaid and its diagram parsers off the initial board load.
        const { default: mermaid } = await import('mermaid')
        if (cancelled) return
        const style = getComputedStyle(document.documentElement)
        const color = (name: string) => style.getPropertyValue(name).trim()
        mermaid.initialize({
          startOnLoad: false, securityLevel: 'strict', suppressErrorRendering: true,
          maxTextSize: 20000, maxEdges: 500, htmlLabels: false,
          secure: ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'maxEdges', 'suppressErrorRendering', 'htmlLabels', 'theme', 'themeCSS', 'themeVariables', 'fontFamily', 'altFontFamily'],
          theme: 'base', fontFamily: '-apple-system, BlinkMacSystemFont, Segoe UI, sans-serif',
          flowchart: { htmlLabels: false },
          themeVariables: {
            darkMode: document.documentElement.dataset.theme === 'dark',
            background: color('--surface'), primaryColor: color('--accent-soft'),
            primaryTextColor: color('--text'), primaryBorderColor: color('--accent-text'),
            secondaryColor: color('--column'), tertiaryColor: color('--bg'),
            lineColor: color('--secondary'), textColor: color('--text'),
          },
        })
        const { svg } = await mermaid.render(`ticket-diagram-${++diagramID}`, source)
        if (!cancelled && container.current) {
          // Descriptions are untrusted. Do not allow active SVG content or links,
          // even if a diagram attempts to override Mermaid's strict settings.
          container.current.innerHTML = DOMPurify.sanitize(svg, {
            USE_PROFILES: { svg: true, svgFilters: true },
            FORBID_TAGS: ['foreignObject', 'a'], FORBID_ATTR: ['href', 'xlink:href'],
          })
        }
      } catch {
        if (!cancelled) setError(true)
      }
    }
    render()
    return () => { cancelled = true }
  }, [source, appearance])

  return <div className="mermaid-diagram">{error && <><p className="diagram-error" role="status">Unable to render Mermaid diagram. Check its syntax or size.</p><pre><code>{source}</code></pre></>}<div ref={container} role="img" aria-label="Mermaid diagram" hidden={error} /></div>
}

export function MarkdownDescription({ source }: { source: string }) {
  const appearance = useAppearance()
  return <div className="markdown"><Markdown remarkPlugins={[remarkGfm]} skipHtml components={{
    h1: ({ children }) => <h2>{children}</h2>,
    pre: ({ children, node }) => {
      const code = node?.children[0]
      if (code?.type === 'element' && code.tagName === 'code' && Array.isArray(code.properties.className) && code.properties.className.includes('language-mermaid')) {
        const source = code.children.filter(child => child.type === 'text').map(child => child.value).join('').replace(/\n$/, '')
        return <MermaidDiagram source={source} appearance={appearance} />
      }
      return <pre>{children}</pre>
    },
    a: ({ children, href }) => <a href={href} rel="noopener noreferrer">{children}</a>,
  }}>{source}</Markdown></div>
}
