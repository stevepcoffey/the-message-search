'use client'

import { useState } from 'react'

export default function Home() {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState('chat')
  const [submode, setSubmode] = useState('semantic')
  const [source, setSource] = useState('both')
  const [messages, setMessages] = useState<any[]>([])
  const [results, setResults] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [sourceFilter, setSourceFilter] = useState('all')

  const send = async () => {
    if (!query.trim() || loading) return
    const q = query.trim()
    setQuery('')
    setLoading(true)

    if (mode === 'chat') {
      setResults([])
      const next = [...messages, { role: 'user', content: q }]
      setMessages(next)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q })
      })
      const data = await res.json()
      setMessages([...next, { role: 'assistant', content: data.response, sources: data.sources }])
    } else {
      setMessages([])
      const res = await fetch('/api/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: q, mode: submode, source })
      })
      const data = await res.json()
      setResults(data.results || [])
      setSourceFilter('all')
    }

    setLoading(false)
  }

  const filtered = sourceFilter === 'all' ? results : results.filter(r => r.source === sourceFilter)

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', fontFamily: 'Inter, sans-serif', background: '#ffffff' }}>

      {/* Header */}
      <div style={{ padding: '12px 24px', borderBottom: '1px solid #e5e5e3', display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{ width: 28, height: 28, borderRadius: 8, background: '#c47a1a', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'white', fontSize: 14, fontWeight: 700 }}>M</div>
        <span style={{ fontWeight: 600, fontSize: 15, letterSpacing: '-0.02em' }}>The Message Search</span>
      </div>

      {/* Content */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '24px', maxWidth: 720, margin: '0 auto', width: '100%' }}>

        {/* Empty state */}
        {!messages.length && !results.length && !loading && (
          <div style={{ textAlign: 'center', paddingTop: 80 }}>
            <div style={{ fontSize: 22, fontWeight: 600, marginBottom: 8 }}>Search the Message & Bible</div>
            <p style={{ color: '#5a5a56', fontSize: 14, lineHeight: 1.6 }}>Chat for AI answers or search for exact quotes from William Branham's sermons and the KJV Bible.</p>
          </div>
        )}

        {/* Chat messages */}
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
                        <div style={{ fontWeight: 500 }}>{s.title || s.book}</div>
                        <div style={{ color: '#a3a39e', marginTop: 2 }}>{s.date || `${s.book} ${s.chapter}:${s.verse}`}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Search results */}
        {results.length > 0 && (
          <div>
            <div style={{ display: 'flex', gap: 6, marginBottom: 16, flexWrap: 'wrap' }}>
              {['all', 'message', 'bible'].map(f => (
                <button key={f} onClick={() => setSourceFilter(f)} style={{ padding: '5px 12px', borderRadius: 20, border: `1px solid ${sourceFilter === f ? '#c47a1a' : '#e5e5e3'}`, background: sourceFilter === f ? '#fdf4e7' : 'transparent', color: sourceFilter === f ? '#a36214' : '#a3a39e', fontSize: 12, fontWeight: sourceFilter === f ? 500 : 400, cursor: 'pointer' }}>
                  {f === 'all' ? `All (${results.length})` : f === 'message' ? `The Message (${results.filter(r => r.source === 'message').length})` : `KJV Bible (${results.filter(r => r.source === 'bible').length})`}
                </button>
              ))}
            </div>
            {filtered.map((r: any, i: number) => (
              <div key={i} style={{ marginBottom: 12, padding: '14px 16px', borderRadius: 12, border: '1px solid #e5e5e3', background: '#ffffff' }}>
                <div style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center' }}>
                  <span style={{ padding: '2px 8px', borderRadius: 4, background: r.source === 'message' ? '#fdf4e7' : 'rgba(91,141,217,0.1)', color: r.source === 'message' ? '#a36214' : '#3a6abf', fontSize: 11, fontWeight: 600 }}>
                    {r.source === 'message' ? 'The Message' : 'KJV Bible'}
                  </span>
                  <span style={{ fontSize: 13, fontWeight: 500 }}>{r.title || r.reference || `${r.book} ${r.chapter}:${r.verse}`}</span>
                </div>
                <p style={{ fontSize: 13, fontStyle: 'italic', fontFamily: 'Georgia, serif', lineHeight: 1.75, borderLeft: '2px solid #c47a1a', paddingLeft: 12, marginBottom: 10 }}>"{r.text}"</p>
                {r.date && <div style={{ fontSize: 11, color: '#a3a39e', marginBottom: 8 }}>{r.date} · {r.location}</div>}
                <button onClick={() => navigator.clipboard.writeText(`${r.title || r.book} (${r.date || 'KJV'})\n"${r.text}"`)} style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #e5e5e3', background: 'transparent', fontSize: 11, color: '#a3a39e', cursor: 'pointer' }}>Copy quote</button>
              </div>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && <div style={{ display: 'flex', gap: 5, padding: 16 }}>
          {[0,1,2].map(j => <div key={j} style={{ width: 7, height: 7, borderRadius: '50%', background: '#c47a1a', opacity: 0.5 }}/>)}
        </div>}
      </div>

      {/* Input */}
      <div style={{ padding: '12px 24px 20px', borderTop: '1px solid #e5e5e3' }}>
        <div style={{ maxWidth: 720, margin: '0 auto' }}>
          <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
            <div style={{ display: 'flex', background: '#f2f2f0', borderRadius: 8, padding: 3, gap: 2 }}>
              {[{id:'chat',label:'Chat'},{id:'search',label:'Search'}].map(m => (
                <button key={m.id} onClick={() => setMode(m.id)} style={{ padding: '5px 12px', borderRadius: 6, background: mode === m.id ? m.id === 'chat' ? '#c47a1a' : '#ffffff' : 'transparent', color: mode === m.id ? m.id === 'chat' ? 'white' : '#1a1a18' : '#a3a39e', fontSize: 13, fontWeight: mode === m.id ? 500 : 400, border: 'none', cursor: 'pointer' }}>{m.label}</button>
              ))}
            </div>
            {mode === 'search' && (
              <>
                <div style={{ display: 'flex', background: '#f2f2f0', borderRadius: 8, padding: 3, gap: 2 }}>
                  {[{id:'semantic',label:'Semantic'},{id:'exact',label:'Exact'},{id:'allwords',label:'All words'},{id:'anyword',label:'Any word'}].map(m => (
                    <button key={m.id} onClick={() => setSubmode(m.id)} style={{ padding: '5px 10px', borderRadius: 6, background: submode === m.id ? '#ffffff' : 'transparent', color: submode === m.id ? '#1a1a18' : '#a3a39e', fontSize: 12, fontWeight: submode === m.id ? 500 : 400, border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>{m.label}</button>
                  ))}
                </div>
                <div style={{ display: 'flex', background: '#f2f2f0', borderRadius: 8, padding: 3, gap: 2 }}>
                  {[{id:'both',label:'Both'},{id:'message',label:'Message'},{id:'bible',label:'Bible'}].map(s => (
                    <button key={s.id} onClick={() => setSource(s.id)} style={{ padding: '5px 10px', borderRadius: 6, background: source === s.id ? '#ffffff' : 'transparent', color: source === s.id ? '#1a1a18' : '#a3a39e', fontSize: 12, fontWeight: source === s.id ? 500 : 400, border: 'none', cursor: 'pointer' }}>{s.label}</button>
                  ))}
                </div>
              </>
            )}
          </div>
          <div style={{ display: 'flex', gap: 8, background: '#ffffff', borderRadius: 14, border: '1px solid #d0d0ca', padding: '10px 12px', boxShadow: '0 2px 12px rgba(0,0,0,0.06)' }}>
            <input value={query} onChange={e => setQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && send()} placeholder={mode === 'chat' ? 'Ask about the Message or the Bible…' : 'Search for a quote or verse…'} style={{ flex: 1, border: 'none', outline: 'none', fontSize: 15, background: 'transparent', color: '#1a1a18' }}/>
            <button onClick={send} disabled={!query.trim() || loading} style={{ width: 34, height: 34, borderRadius: 10, background: query.trim() && !loading ? '#c47a1a' : '#f2f2f0', color: query.trim() && !loading ? 'white' : '#a3a39e', border: 'none', cursor: query.trim() && !loading ? 'pointer' : 'default', fontSize: 16 }}>→</button>
          </div>
          <p style={{ textAlign: 'center', fontSize: 11, color: '#a3a39e', marginTop: 6 }}>William Branham's sermons & KJV Bible only</p>
        </div>
      </div>
    </div>
  )
}