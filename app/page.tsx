'use client'

import { useState } from 'react'

export default function Home() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('chat')
  const [messages, setMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

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
    }
    setLoading(false)
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'Inter, sans-serif', background: '#fff' }}>
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #e5e5e3', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#c47a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>M</div>
        <span style={{ fontWeight: 600, fontSize: 15 }}>The Message Search</span>
      </div>

      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>
        {!messages.length && !loading && (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Search the Message & Bible</div>
            <p style={{ color: '#5a5a56', fontSize: 14, lineHeight: 1.6 }}>Ask anything about William Branham's sermons and the KJV Bible.</p>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={i} style={{ marginBottom: 20 }}>
            {m.role === 'user' ? (
              <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                <div style={{ background: '#1a1a18', color: 'white', borderRadius: 16, borderBottomRightRadius: 4, padding: '10px 16px', maxWidth: '75%', fontSize: 14, lineHeight: 1.6 }}>{m.content}</div>
              </div>
            ) : (
              <div style={{ fontSize: 14, lineHeight: 1.8, color: '#1a1a18' }}>
                {m.content?.split('\n').map((line: string, j: number) => (
                  line.startsWith('> ')
                    ? <blockquote key={j} style={{ borderLeft: '2.5px solid #c47a1a', paddingLeft: 14, margin: '12px 0', fontStyle: 'italic', color: '#5a5a56' }}>{line.slice(2)}</blockquote>
                    : <p key={j} style={{ marginBottom: 8 }}>{line}</p>
                ))}
                {m.sources?.length > 0 && (
                  <div style={{ marginTop: 12, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {m.sources.map((s: any, k: number) => (
                      <div key={k} style={{ padding: '6px 10px', borderRadius: 8, border: '1px solid #e5e5e3', background: '#f9f9f8', fontSize: 12 }}>
                        <div style={{ fontWeight: 500 }}>{s.title}</div>
                        <div style={{ color: '#a3a39e', marginTop: 2 }}>{s.date}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {loading && (
          <div style={{ display: 'flex', gap: 5, padding: 16 }}>
            {[0,1,2].map(j => (
              <div key={j} style={{ width: 7, height: 7, borderRadius: '50%', background: '#c47a1a', opacity: 0.6, animation: `pulse 1.2s ease ${j * 0.2}s infinite` }}/>
            ))}
          </div>
        )}
      </div>

      <div style={{ padding: '12px 24px 24px', borderTop: '1px solid #e5e5e3' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 8, background: '#fff', borderRadius: 14, border: '1px solid #d0d0ca', padding: '10px 12px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <input
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && send()}
              placeholder="Ask about the Message or the Bible…"
              style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: '#1a1a18' }}
            />
            <button
              onClick={send}
              disabled={!query.trim() || loading}
              style={{ width: 34, height: 34, borderRadius: 10, background: query.trim() && !loading ? '#c47a1a' : '#f2f2f0', color: query.trim() && !loading ? 'white' : '#a3a39e', border: 'none', cursor: query.trim() && !loading ? 'pointer' : 'default', fontSize: 16 }}
            >→</button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: '#a3a39e', marginTop: 6 }}>William Branham's sermons & KJV Bible only</p>
        </div>
      </div>
    </div>
  )
}
