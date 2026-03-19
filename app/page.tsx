'use client'

import { useState, useRef, useEffect } from 'react'
import ReactMarkdown from 'react-markdown'

export default function Home() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('chat')
  const [messages, setMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState<number | null>(null)
  const endRef = useRef<HTMLDivElement>(null)
  const taRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  useEffect(() => {
    if (taRef.current) {
      taRef.current.style.height = '24px'
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 120) + 'px'
    }
  }, [query])

  const send = async () => {
    if (!query.trim() || loading) return
    const q = query.trim()
    setQuery('')
    setLoading(true)
    const next = [...messages, { role: 'user', content: q }]
    setMessages(next)
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      })
      const data = await res.json()
      setMessages([...next, { role: 'assistant', content: data.response, sources: data.sources }])
    } catch (err) {
      console.error(err)
      setMessages([...next, { role: 'assistant', content: 'Something went wrong. Please try again.', sources: [] }])
    }
    setLoading(false)
  }

  const copyText = (text: string, i: number) => {
    navigator.clipboard.writeText(text)
    setCopied(i)
    setTimeout(() => setCopied(null), 2000)
  }

  const isEmpty = !messages.length && !loading

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: "'Inter', -apple-system, sans-serif", background: '#ffffff', color: '#0d0d0c' }}>

      <div style={{ height: 52, borderBottom: '1px solid rgba(0,0,0,0.07)', display: 'flex', alignItems: 'center', padding: '0 20px', gap: 10, flexShrink: 0 }}>
        <div style={{ width: 28, height: 28, borderRadius: 9, background: '#c47a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none">
            <path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
            <path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </div>
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>The Message Search</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '0 20px' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>

          {isEmpty && (
            <div style={{ paddingTop: 80, textAlign: 'center' }}>
              <div style={{ width: 52, height: 52, borderRadius: 16, background: '#c47a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', margin: '0 auto 20px' }}>
                <svg width="24" height="24" viewBox="0 0 20 20" fill="none">
                  <path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
                  <path d="M7 10l2 2 4-4" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </div>
              <h1 style={{ fontSize: 22, fontWeight: 600, letterSpacing: '-0.03em', marginBottom: 8 }}>The Message Search</h1>
              <p style={{ color: '#5a5a56', fontSize: 14, lineHeight: 1.65, maxWidth: 400, margin: '0 auto 40px' }}>Ask questions and search William Branham's sermons and the KJV Bible. Every answer comes directly from the source.</p>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxWidth: 480, margin: '0 auto', textAlign: 'left' }}>
                {[
                  { q: 'What did Branham teach about the new birth?', mode: 'chat' },
                  { q: 'What is the token of the blood?', mode: 'chat' },
                  { q: 'What did Branham say about healing?', mode: 'chat' },
                ].map((s, i) => (
                  <button key={i} onClick={() => { setQuery(s.q); setMode(s.mode) }} style={{ padding: '12px 16px', borderRadius: 10, border: '1px solid rgba(0,0,0,0.07)', background: '#f9f9f8', cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left', transition: 'all .15s' }}>
                    <div style={{ fontSize: 10.5, fontWeight: 600, color: '#c47a1a', textTransform: 'uppercase' as const, letterSpacing: '0.07em', marginBottom: 3 }}>Chat</div>
                    <div style={{ fontSize: 13.5, color: '#5a5a56' }}>{s.q}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ paddingTop: 24, paddingBottom: 16 }}>
            {messages.map((m, i) => (
              <div key={i} style={{ marginBottom: 24 }}>
                {m.role === 'user' ? (
                  <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                    <div style={{ background: '#1a1a18', color: '#f2f2ef', borderRadius: 18, borderBottomRightRadius: 4, padding: '10px 16px', maxWidth: '75%', fontSize: 14.5, lineHeight: 1.55 }}>{m.content}</div>
                  </div>
                ) : (
                  <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                    <div style={{ width: 28, height: 28, borderRadius: 8, background: '#c47a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, marginTop: 2 }}>
                      <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                        <path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
                      </svg>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 14.5, lineHeight: 1.75, color: '#0d0d0c' }}>
                        <ReactMarkdown
                          components={{
                            p: ({children}) => <p style={{ marginBottom: 10, lineHeight: 1.75, fontWeight: 400 }}>{children}</p>,
                            h1: ({children}) => <h1 style={{ fontSize: 17, fontWeight: 600, marginBottom: 8, marginTop: 16, letterSpacing: '-0.02em' }}>{children}</h1>,
                            h2: ({children}) => <h2 style={{ fontSize: 15, fontWeight: 600, marginBottom: 6, marginTop: 14, letterSpacing: '-0.01em' }}>{children}</h2>,
                            h3: ({children}) => <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 4, marginTop: 12 }}>{children}</h3>,
                            blockquote: ({children}) => <blockquote style={{ borderLeft: '2.5px solid #c47a1a', paddingLeft: 14, margin: '12px 0', fontStyle: 'italic', color: '#5a5a56', fontSize: 14, lineHeight: 1.75 }}>{children}</blockquote>,
                            strong: ({children}) => <strong style={{ fontWeight: 600, color: '#0d0d0c' }}>{children}</strong>,
                            ul: ({children}) => <ul style={{ paddingLeft: 20, marginBottom: 10 }}>{children}</ul>,
                            ol: ({children}) => <ol style={{ paddingLeft: 20, marginBottom: 10 }}>{children}</ol>,
                            li: ({children}) => <li style={{ marginBottom: 4, lineHeight: 1.65 }}>{children}</li>,
                          }}
                        >
                          {m.content || ''}
                        </ReactMarkdown>
                      </div>
                      {m.sources && m.sources.length > 0 && (
                        <div style={{ marginTop: 14, display: 'flex', gap: 7, flexWrap: 'wrap' as const }}>
                          {m.sources.map((s: any, k: number) => (
                            <div key={k} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid rgba(0,0,0,0.08)', background: '#f9f9f8', fontSize: 12 }}>
                              <div style={{ fontWeight: 500, color: '#0d0d0c' }}>{s.title || 'William Branham Sermon'}</div>
                              <div style={{ color: '#a3a39e', marginTop: 1 }}>{s.date ? s.date.slice(0, 4) : ''}</div>
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ display: 'flex', gap: 6, marginTop: 12 }}>
                        <button onClick={() => copyText(m.content, i)} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 10px', borderRadius: 6, border: '1px solid rgba(0,0,0,0.08)', background: 'transparent', color: copied === i ? '#c47a1a' : '#a3a39e', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                          {copied === i ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {loading && (
              <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
                <div style={{ width: 28, height: 28, borderRadius: 8, background: '#c47a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <svg width="13" height="13" viewBox="0 0 20 20" fill="none">
                    <path d="M10 2L3 5.5V10c0 4.1 3 7.7 7 8.5 4-.8 7-4.4 7-8.5V5.5L10 2z" stroke="white" strokeWidth="1.5" strokeLinejoin="round"/>
                  </svg>
                </div>
                <div style={{ display: 'flex', gap: 5, padding: '10px 0' }}>
                  {[0, 1, 2].map(j => <div key={j} style={{ width: 7, height: 7, borderRadius: '50%', background: '#c47a1a', opacity: 0.4 }} />)}
                </div>
              </div>
            )}
            <div ref={endRef} />
          </div>
        </div>
      </div>

      <div style={{ borderTop: '1px solid rgba(0,0,0,0.07)', padding: '12px 20px 20px', flexShrink: 0 }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', background: '#f2f2f0', borderRadius: 8, padding: 3, gap: 2 }}>
              {[{ id: 'chat', label: 'Chat' }, { id: 'search', label: 'Search' }].map(m => (
                <button key={m.id} onClick={() => setMode(m.id)} style={{ padding: '5px 16px', borderRadius: 6, background: mode === m.id ? (m.id === 'chat' ? '#c47a1a' : '#ffffff') : 'transparent', color: mode === m.id ? (m.id === 'chat' ? 'white' : '#0d0d0c') : '#a3a39e', fontSize: 13, fontWeight: mode === m.id ? 500 : 400, border: 'none', cursor: 'pointer', fontFamily: 'inherit', transition: 'all .15s' }}>{m.label}</button>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8, background: '#ffffff', borderRadius: 16, border: '1px solid rgba(0,0,0,0.12)', padding: '10px 12px', boxShadow: '0 2px 16px rgba(0,0,0,0.06)', alignItems: 'flex-end' }}>
            <textarea
              ref={taRef}
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
              placeholder={mode === 'chat' ? 'Ask about the Message or the Bible...' : 'Search for a quote or verse...'}
              rows={1}
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, lineHeight: 1.45, background: 'transparent', color: '#0d0d0c', resize: 'none', fontFamily: 'inherit', maxHeight: 120, overflow: 'auto' }}
            />
            <button onClick={send} disabled={!query.trim() || loading} style={{ width: 36, height: 36, borderRadius: 10, background: query.trim() && !loading ? '#c47a1a' : '#f2f2f0', color: query.trim() && !loading ? 'white' : '#a3a39e', border: 'none', cursor: query.trim() && !loading ? 'pointer' : 'default', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'all .15s' }}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13"/><path d="M22 2L15 22l-4-9-9-4 20-7z"/></svg>
            </button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: '#a3a39e', marginTop: 7 }}>William Branham's sermons & KJV Bible only</p>
        </div>
      </div>

      <style dangerouslySetInnerHTML={{__html: `
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600&display=swap');
        * { box-sizing: border-box; margin: 0; padding: 0; }
        textarea { caret-color: #c47a1a; }
      `}} />
    </div>
  )
}